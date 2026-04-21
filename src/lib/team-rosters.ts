import devTeam from '../../testing/data/dev-team.json';
import qaTeam from '../../testing/data/qa-team.json';

export interface DevTeamRosterMember {
  alias: string;
  name: string;
  githubLogin: string;
  jiraDisplayName?: string;
  jiraEmail?: string;
}

export interface QaTeamRosterMember {
  alias: string;
  name: string;
  email?: string;
  githubLogin?: string;
}

export interface QaDefaultComparison {
  alias: string;
  slug: string;
  leftQaAlias: string;
  rightQaAlias: string;
}

export interface DevTeamRoster {
  members: DevTeamRosterMember[];
}

export interface QaTeamRoster {
  defaultProject?: string;
  members: QaTeamRosterMember[];
  defaultComparisons?: QaDefaultComparison[];
}

export function getDevTeamRoster(): DevTeamRoster {
  return devTeam as DevTeamRoster;
}

export function getQaTeamRoster(): QaTeamRoster {
  return qaTeam as QaTeamRoster;
}
