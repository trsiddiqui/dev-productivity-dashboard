import { NextResponse } from 'next/server';
import {
  getJiraSprintMeta,
  getJiraSprintIssues,
  getJiraSprintScopeChanges,
  getIssuePhaseTimes,
  getJiraIssuePRs,
  getJiraSubtaskIds,
  getQAAssignmentTimesAll,
} from '@/lib/jira';
import { getGithubPRStatsByUrls } from '@/lib/github';
import type {
  SprintStatsResponse,
  JiraIssue,
  SprintBurnItem,
  SprintKPI,
  CompletedByAssignee,
  LinkedPR,
} from '@/lib/types';
import { eachDayOfInterval, formatISO } from 'date-fns';
import { requireAuthOr401 } from '@/lib/auth';
import { cfg } from '@/lib/config'; // NEW

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


const TODO_STATUS_NAMES = ['To Do', 'Impeded', 'Open', 'Backlog', 'Selected for Development'];
const INPROGRESS_STATUS_NAMES = ['In Progress', 'Merged', 'In Development', 'In-Progress', 'Doing', 'Selected for Development'];
const QA_STATUS_NAMES = ['Reviewed', 'Review', 'In Review'];
const COMPLETE_STATUS_NAMES = ['Done', 'Approved'];

const REVIEW_SET = new Set(QA_STATUS_NAMES.map((s) => s.toLowerCase()));


const toDateOnly = (iso?: string): string | undefined => (iso ? iso.slice(0, 10) : undefined);
const dayKey = (d: Date): string => formatISO(d, { representation: 'date' });
const diffHours = (a?: string, b?: string): number | null => {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.max(0, (t2 - t1) / 36e5);
};
function avgVelocity(series: number[], window = 5): number {
  if (series.length < 2) return 0;
  const start = Math.max(1, series.length - window);
  let sum = 0, n = 0;
  for (let i = start; i < series.length; i += 1) {
    const inc = series[i] - series[i - 1];
    if (inc > 0) { sum += inc; n += 1; }
  }
  return n ? sum / n : 0;
}

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req); if (auth instanceof Response) return auth;
  const warnings: string[] = [];

  try {
    const { searchParams } = new URL(req.url);
    const sprintIdStr = searchParams.get('sprintId');
    if (!sprintIdStr) {
      return NextResponse.json({ error: 'Missing sprintId' }, { status: 400 });
    }
    const sprintId = Number(sprintIdStr);


    const meta = await getJiraSprintMeta(sprintId);
    if (!meta) {
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
    }


    const issues: JiraIssue[] = await getJiraSprintIssues(sprintId);


    const phaseTimes = await getIssuePhaseTimes(
      issues.map((i) => i.key),
      { todo: TODO_STATUS_NAMES, inProgress: INPROGRESS_STATUS_NAMES, review: QA_STATUS_NAMES, complete: COMPLETE_STATUS_NAMES }
    );


    for (const it of issues) {
      const p = phaseTimes[it.key] ?? {};
      it.todoAt = p.todo;
      it.inProgressAt = p.inProgress;

      it.reviewAt = p.review ?? p.complete;
      it.completeAt = p.complete;
      it.inProgressToReviewHours = diffHours(p.inProgress, p.review ?? p.complete);
      it.reviewToCompleteHours = diffHours(p.review ?? p.complete, p.complete);
    }


    try {
      if (cfg.jiraQAAssigneeField) {
        const rows = issues
          .filter(i => (i.qaAssignees?.length ?? 0) > 0)
          .map(i => ({ key: i.key, qa: i.qaAssignees! }));

        const qaAssignTimes = await getQAAssignmentTimesAll(rows, cfg.jiraQAAssigneeField);

        for (const it of issues) {
          if (!it.qaAssignees?.length) continue;
          it.qaAssignedAtMap = qaAssignTimes[it.key] ?? {};
          it.qaReviewToCompleteHoursByQA = it.qaReviewToCompleteHoursByQA ?? {};
          for (const qa of it.qaAssignees) {
            const qaKey = qa.id ? `id:${qa.id}` : `name:${(qa.name ?? '').trim().toLowerCase()}`;
            const reviewStart = it.reviewAt ?? it.completeAt;
            if (!it.completeAt || !reviewStart) {
              it.qaReviewToCompleteHoursByQA[qaKey] = null;
              continue;
            }
            const assignAt = it.qaAssignedAtMap?.[qaKey];
            const start = assignAt && new Date(assignAt).getTime() > new Date(reviewStart).getTime()
              ? assignAt
              : reviewStart;
            it.qaReviewToCompleteHoursByQA[qaKey] = diffHours(start, it.completeAt);
          }
        }
      }
    } catch {
      warnings.push('QA assignment times unavailable (insufficient Jira permissions or missing JIRA_QA_ASSIGNEE_FIELD).');
    }


    try {
      const parents = issues.filter(
        i => ['story', 'bug', 'task'].includes((i.issueType ?? '').toLowerCase())
      );

      const parentKeyToIssue = new Map<string, JiraIssue>();
      parents.forEach(p => parentKeyToIssue.set(p.key, p));


      const subtaskIdsByParentKey = await getJiraSubtaskIds(parents.map(p => p.key)).catch(() => ({} as Record<string, string[]>));


      const allIssueIds = new Set<string>();
      parents.forEach(p => allIssueIds.add(p.id));
      Object.values(subtaskIdsByParentKey).forEach(arr => arr.forEach(id => allIssueIds.add(id)));


      const prsByIssueId = await getJiraIssuePRs(Array.from(allIssueIds)).catch(() => ({} as Record<string, LinkedPR[]>));


      const allUrls = new Set<string>();
      const urlsByParentKey = new Map<string, string[]>();

      for (const p of parents) {
        const own = prsByIssueId[p.id] ?? [];
        const childIds = subtaskIdsByParentKey[p.key] ?? [];
        const childPRs: LinkedPR[] = childIds.flatMap(id => prsByIssueId[id] ?? []);

        const urls = [...own, ...childPRs]
          .map(pr => pr.url)
          .filter(Boolean);

        const unique = Array.from(new Set(urls));
        urlsByParentKey.set(p.key, unique);
        unique.forEach(u => { if (u.includes('github.com')) allUrls.add(u); });


        p.linkedPRs = [...own, ...childPRs];
      }


      const statsByUrl = await getGithubPRStatsByUrls(Array.from(allUrls));


      for (const p of parents) {
        const urls = urlsByParentKey.get(p.key) ?? [];
        let add = 0;
        let del = 0;
        for (const u of urls) {
          const s = statsByUrl[u];
          if (s) {
            add += s.additions;
            del += s.deletions;
          }
        }
        p.prAdditions = add;
        p.prDeletions = del;
      }
    } catch {
      warnings.push('PR → LOC aggregation unavailable (dev-status/permissions)');
    }


    const start = meta.startDate ? new Date(meta.startDate) : null;
    const end = meta.endDate ? new Date(meta.endDate) : null;
    const now = new Date();

    const sp = (it: JiraIssue): number =>
      typeof it.storyPoints === 'number' ? it.storyPoints : 0;


    let scopeByKey: Record<string, 'added' | 'removed' | 'committed'> = {};
    try {
      scopeByKey = await getJiraSprintScopeChanges(
        sprintId,
        issues.map((i) => i.key),
        meta.startDate,
      );
    } catch {
      warnings.push('Scope change classification unavailable (insufficient Jira permissions or changelog disabled)');
    }

    let committedSP = 0;
    let addedSP = 0;
    const removedSP = 0;

    for (const it of issues) {
      const tag = scopeByKey[it.key] ?? 'committed';
      if (tag === 'added') addedSP += sp(it);
      else committedSP += sp(it);
    }
    const totalScope = Math.max(0, committedSP + addedSP - removedSP);

    const effectiveEnd = end && end.getTime() < now.getTime() ? end : now;

    let devCompletedSP = 0;
    let completeCompletedSP = 0;
    for (const it of issues) {
      if (it.reviewAt && new Date(it.reviewAt) <= effectiveEnd) devCompletedSP += sp(it);
      if (it.completeAt && new Date(it.completeAt) <= effectiveEnd) completeCompletedSP += sp(it);
    }
    const devRemainingSP = Math.max(0, totalScope - devCompletedSP);
    const completeRemainingSP = Math.max(0, totalScope - completeCompletedSP);


    const byAssigneeDev = new Map<string, number>();
    const byAssigneeComplete = new Map<string, number>();
    for (const it of issues) {
      const who = it.assignee && it.assignee.trim().length > 0 ? it.assignee : 'Unassigned';
      const pts = sp(it);
      if (it.reviewAt && new Date(it.reviewAt) <= effectiveEnd) {
        byAssigneeDev.set(who, (byAssigneeDev.get(who) ?? 0) + pts);
      }
      if (it.completeAt && new Date(it.completeAt) <= effectiveEnd) {
        byAssigneeComplete.set(who, (byAssigneeComplete.get(who) ?? 0) + pts);
      }
    }
    const allNames = new Set<string>([...byAssigneeDev.keys(), ...byAssigneeComplete.keys()]);
    const completedByAssignee: CompletedByAssignee[] = Array.from(allNames)
      .map((name) => ({
        assignee: name,
        devPoints: byAssigneeDev.get(name) ?? 0,
        completePoints: byAssigneeComplete.get(name) ?? 0,
      }))
      .sort((a, b) => b.completePoints - a.completePoints || b.devPoints - a.devPoints);


    const ticketsInQA = issues.reduce<number>((acc, it) => {
      const cur = (it.status ?? '').toLowerCase();
      return acc + (REVIEW_SET.has(cur) ? 1 : 0);
    }, 0);


    const burn: SprintBurnItem[] = [];
    if (start) {
      const endForSeries = end ?? now;
      const days = eachDayOfInterval({ start, end: endForSeries });

      for (const d of days) {
        const key = dayKey(d);
        let devDone = 0;
        let compDone = 0;
        for (const it of issues) {
          if (it.reviewAt && new Date(it.reviewAt) <= d) devDone += sp(it);
          if (it.completeAt && new Date(it.completeAt) <= d) compDone += sp(it);
        }
        const committedUpToDay = totalScope;
        burn.push({
          date: key,
          committed: committedUpToDay,
          completed: compDone,
          remaining: Math.max(0, committedUpToDay - compDone),
          devCompleted: devDone,
          devRemaining: Math.max(0, committedUpToDay - devDone),
          completeCompleted: compDone,
          completeRemaining: Math.max(0, committedUpToDay - compDone),
        });
      }
    }


    let devCompletionDate: string | undefined;
    let completeCompletionDate: string | undefined;

    if (burn.length > 0) {
      const nowDt = now;
      const todayKey = dayKey(nowDt);
      let todayIdx = burn.findIndex((b) => b.date === todayKey);
      if (todayIdx < 0) {
        const idx = burn.findIndex((b) => new Date(b.date) > nowDt);
        todayIdx = idx > 0 ? idx - 1 : burn.length - 1;
      }

      const histDev = burn.slice(0, todayIdx + 1).map((b) => b.devCompleted);
      const histComp = burn.slice(0, todayIdx + 1).map((b) => b.completeCompleted);

      const vDev = avgVelocity(histDev, 5);
      const vComp = avgVelocity(histComp, 5);

      if (todayIdx >= 0 && todayIdx < burn.length - 1) {
        if (vDev > 0) {
          let cur = histDev[histDev.length - 1] ?? 0;
          for (let i = todayIdx + 1; i < burn.length; i += 1) {
            cur = Math.min(totalScope, cur + vDev);
            burn[i].devForecastCompleted = cur;
            burn[i].devForecastRemaining = Math.max(0, totalScope - cur);
          }
          const devRem = Math.max(0, totalScope - (histDev[histDev.length - 1] ?? 0));
          const daysNeeded = Math.ceil(devRem / vDev);
          const dateDone = new Date(burn[todayIdx].date);
          dateDone.setDate(dateDone.getDate() + daysNeeded);
          devCompletionDate = dayKey(dateDone);
        }

        if (vComp > 0) {
          let cur = histComp[histComp.length - 1] ?? 0;
          for (let i = todayIdx + 1; i < burn.length; i += 1) {
            cur = Math.min(totalScope, cur + vComp);
            burn[i].completeForecastCompleted = cur;
            burn[i].completeForecastRemaining = Math.max(0, totalScope - cur);
          }
          const compRem = Math.max(0, totalScope - (histComp[histComp.length - 1] ?? 0));
          const daysNeeded = Math.ceil(compRem / vComp);
          const dateDone = new Date(burn[todayIdx].date);
          dateDone.setDate(dateDone.getDate() + daysNeeded);
          completeCompletionDate = dayKey(dateDone);
        }
      }
    }

    const pct = (num: number, den: number): number =>
      den > 0 ? Number(((num / den) * 100).toFixed(1)) : 0;


    const totalPRAdditions = issues.reduce((a, it) => a + (it.prAdditions ?? 0), 0);
    const totalPRDeletions = issues.reduce((a, it) => a + (it.prDeletions ?? 0), 0);

    const kpis: SprintKPI = {
      committedSP,
      scopeAddedSP: addedSP,
      scopeRemovedSP: removedSP,

      completedSP: completeCompletedSP,
      remainingSP: completeRemainingSP,
      completionPct: pct(completeCompletedSP, totalScope),

      devCompletedSP,
      devRemainingSP,
      devCompletionPct: pct(devCompletedSP, totalScope),

      completeCompletedSP,
      completeRemainingSP,
      completeCompletionPct: pct(completeCompletedSP, totalScope),

      totalPRAdditions,
      totalPRDeletions,
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
      forecast: devCompletionDate || completeCompletionDate ? {
        devCompletionDate,
        completeCompletionDate,
      } : undefined,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
