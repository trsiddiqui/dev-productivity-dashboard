import { NextResponse } from 'next/server';
import {
  getJiraSprintMeta,
  getJiraSprintIssues,
  getJiraSprintScopeChanges,
  getIssueFirstReachedStatusDates,
} from '../../../lib/jira';
import type {
  SprintStatsResponse,
  JiraIssue,
  SprintBurnItem,
  SprintKPI,
  CompletedByAssignee,
} from '../../../lib/types';
import { eachDayOfInterval, formatISO } from 'date-fns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What counts as Development complete vs Fully complete in your Jira */
const DEV_STATUS_NAMES = ['Reviewed', 'Review', 'In Review'];
const COMPLETE_STATUS_NAMES = ['Approved', 'Done'];
const REVIEW_SET = new Set(DEV_STATUS_NAMES.map((s) => s.toLowerCase()));

/** Helpers */
const toDateOnly = (iso?: string): string | undefined =>
  iso ? iso.slice(0, 10) : undefined;

const dayKey = (d: Date): string =>
  formatISO(d, { representation: 'date' });

function avgVelocity(series: number[], window = 5): number {
  // average positive daily increment over the last `window` points
  if (series.length < 2) return 0;
  const start = Math.max(1, series.length - window);
  let sum = 0;
  let n = 0;
  for (let i = start; i < series.length; i += 1) {
    const inc = series[i] - series[i - 1];
    if (inc > 0) {
      sum += inc;
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

export async function GET(req: Request) {
  const warnings: string[] = [];

  try {
    const { searchParams } = new URL(req.url);
    const sprintIdStr = searchParams.get('sprintId');
    if (!sprintIdStr) {
      return NextResponse.json(
        { error: 'Missing sprintId' },
        { status: 400 },
      );
    }
    const sprintId = Number(sprintIdStr);

    // Sprint meta (name, dates, etc)
    const meta = await getJiraSprintMeta(sprintId);
    if (!meta) {
      return NextResponse.json(
        { error: 'Sprint not found' },
        { status: 404 },
      );
    }

    // Issues in the sprint (with SP, assignee, status, etc.)
    const issues: JiraIssue[] = await getJiraSprintIssues(sprintId);

    // Dates
    const start = meta.startDate ? new Date(meta.startDate) : null;
    const end = meta.endDate ? new Date(meta.endDate) : null;
    const now = new Date();

    // SP helper
    const sp = (it: JiraIssue): number =>
      typeof it.storyPoints === 'number' ? it.storyPoints : 0;

    // Scope classification via changelog (committed vs added)
    let scopeByKey: Record<string, 'added' | 'removed' | 'committed'> = {};
    try {
      scopeByKey = await getJiraSprintScopeChanges(
        sprintId,
        issues.map((i) => i.key),
        meta.startDate,
      );
    } catch {
      warnings.push(
        'Scope change classification unavailable (insufficient Jira permissions or changelog disabled)',
      );
    }

    // Compute scope totals
    let committedSP = 0;
    let addedSP = 0;
    const removedSP = 0; // keep zero unless you parse true removals too

    for (const it of issues) {
      const tag = scopeByKey[it.key] ?? 'committed';
      if (tag === 'added') addedSP += sp(it);
      else committedSP += sp(it);
    }
    const totalScope = Math.max(0, committedSP + addedSP - removedSP);

    // First time each issue reached Dev (review-ish) and Complete (approved/done)
    const statusDates = await getIssueFirstReachedStatusDates(
      issues.map((i) => i.key),
      { dev: DEV_STATUS_NAMES, complete: COMPLETE_STATUS_NAMES },
    );

    // Effective "today" bound for totals
    const effectiveEnd =
      end && end.getTime() < now.getTime() ? end : now;

    // Totals as of effective end
    let devCompletedSP = 0;
    let completeCompletedSP = 0;
    for (const it of issues) {
      const s = statusDates[it.key] ?? {};
      if (s.dev && new Date(s.dev) <= effectiveEnd) devCompletedSP += sp(it);
      if (s.complete && new Date(s.complete) <= effectiveEnd)
        completeCompletedSP += sp(it);
    }
    const devRemainingSP = Math.max(0, totalScope - devCompletedSP);
    const completeRemainingSP = Math.max(
      0,
      totalScope - completeCompletedSP,
    );

    // --- Completed SP by assignee (Dev vs Complete) ---
    const byAssigneeDev = new Map<string, number>();
    const byAssigneeComplete = new Map<string, number>();
    for (const it of issues) {
      const who =
        it.assignee && it.assignee.trim().length > 0
          ? it.assignee
          : 'Unassigned';
      const pts = sp(it);
      const s = statusDates[it.key] ?? {};
      if (s.dev && new Date(s.dev) <= effectiveEnd) {
        byAssigneeDev.set(who, (byAssigneeDev.get(who) ?? 0) + pts);
      }
      if (s.complete && new Date(s.complete) <= effectiveEnd) {
        byAssigneeComplete.set(
          who,
          (byAssigneeComplete.get(who) ?? 0) + pts,
        );
      }
    }
    const allNames = new Set<string>([
      ...byAssigneeDev.keys(),
      ...byAssigneeComplete.keys(),
    ]);
    const completedByAssignee: CompletedByAssignee[] = Array.from(
      allNames,
    )
      .map((name) => ({
        assignee: name,
        devPoints: byAssigneeDev.get(name) ?? 0,
        completePoints: byAssigneeComplete.get(name) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.completePoints - a.completePoints ||
          b.devPoints - a.devPoints,
      );

    // Tickets currently in QA (in a "review-ish" status)
    const ticketsInQA = issues.reduce<number>((acc, it) => {
      const cur = (it.status ?? '').toLowerCase();
      return acc + (REVIEW_SET.has(cur) ? 1 : 0);
    }, 0);

    // Burn series (per day) with Dev vs Complete
    const burn: SprintBurnItem[] = [];
    if (start) {
      const endForSeries = end ?? now;
      const days = eachDayOfInterval({ start, end: endForSeries });

      for (const d of days) {
        const key = dayKey(d);
        let devDone = 0;
        let compDone = 0;
        for (const it of issues) {
          const s = statusDates[it.key] ?? {};
          if (s.dev && new Date(s.dev) <= d) devDone += sp(it);
          if (s.complete && new Date(s.complete) <= d) compDone += sp(it);
        }
        const committedUpToDay = totalScope;
        burn.push({
          date: key,
          committed: committedUpToDay,

          // legacy "complete"
          completed: compDone,
          remaining: Math.max(0, committedUpToDay - compDone),

          // explicit dev/complete
          devCompleted: devDone,
          devRemaining: Math.max(0, committedUpToDay - devDone),
          completeCompleted: compDone,
          completeRemaining: Math.max(0, committedUpToDay - compDone),
        });
      }
    }

    // --- Forecast: add trend for future dates & predicted completion dates ---
    let devCompletionDate: string | undefined;
    let completeCompletionDate: string | undefined;

    if (burn.length > 0) {
      const todayKey = dayKey(now);
      let todayIdx = burn.findIndex((b) => b.date === todayKey);
      if (todayIdx < 0) {
        const idx = burn.findIndex((b) => new Date(b.date) > now);
        todayIdx = idx > 0 ? idx - 1 : burn.length - 1;
      }

      const histDev = burn
        .slice(0, todayIdx + 1)
        .map((b) => b.devCompleted);
      const histComp = burn
        .slice(0, todayIdx + 1)
        .map((b) => b.completeCompleted);

      const vDev = avgVelocity(histDev, 5); // SP/day
      const vComp = avgVelocity(histComp, 5);

      if (todayIdx >= 0 && todayIdx < burn.length - 1) {
        // DEV forecast
        if (vDev > 0) {
          let cur = histDev[histDev.length - 1] ?? 0;
          for (let i = todayIdx + 1; i < burn.length; i += 1) {
            cur = Math.min(totalScope, cur + vDev);
            burn[i].devForecastCompleted = cur;
            burn[i].devForecastRemaining = Math.max(
              0,
              totalScope - cur,
            );
          }
          const devRem = Math.max(
            0,
            totalScope - (histDev[histDev.length - 1] ?? 0),
          );
          const daysNeeded = Math.ceil(devRem / vDev);
          const dateDone = new Date(burn[todayIdx].date);
          dateDone.setDate(dateDone.getDate() + daysNeeded);
          devCompletionDate = dayKey(dateDone);
        }

        // COMPLETE forecast
        if (vComp > 0) {
          let cur = histComp[histComp.length - 1] ?? 0;
          for (let i = todayIdx + 1; i < burn.length; i += 1) {
            cur = Math.min(totalScope, cur + vComp);
            burn[i].completeForecastCompleted = cur;
            burn[i].completeForecastRemaining = Math.max(
              0,
              totalScope - cur,
            );
          }
          const compRem = Math.max(
            0,
            totalScope - (histComp[histComp.length - 1] ?? 0),
          );
          const daysNeeded = Math.ceil(compRem / vComp);
          const dateDone = new Date(burn[todayIdx].date);
          dateDone.setDate(dateDone.getDate() + daysNeeded);
          completeCompletionDate = dayKey(dateDone);
        }
      }
    }

    // KPIs
    const pct = (num: number, den: number): number =>
      den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0;

    const kpis: SprintKPI = {
      committedSP,
      scopeAddedSP: addedSP,
      scopeRemovedSP: removedSP,

      // legacy == Complete
      completedSP: completeCompletedSP,
      remainingSP: completeRemainingSP,
      completionPct: pct(completeCompletedSP, totalScope),

      // Development progress
      devCompletedSP,
      devRemainingSP,
      devCompletionPct: pct(devCompletedSP, totalScope),

      // Fully complete progress
      completeCompletedSP,
      completeRemainingSP,
      completeCompletionPct: pct(completeCompletedSP, totalScope),
    };

    const payload: SprintStatsResponse = {
      sprintId,
      sprintName: meta.name,
      startDate: toDateOnly(meta.startDate),
      endDate: toDateOnly(meta.endDate),
      kpis,
      burn,
      issues,
      warnings: warnings.length ? warnings : undefined,
      completedByAssignee,
      ticketsInQA,
      forecast:
        devCompletionDate || completeCompletionDate
          ? {
              devCompletionDate,
              completeCompletionDate,
            }
          : undefined,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
