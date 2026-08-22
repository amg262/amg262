#!/usr/bin/env node
// Rewrites the activity block in README.md with live contribution numbers.
// Runs in GitHub Actions; needs a token with read access to the user's profile.

const LOGIN = process.env.PROFILE_LOGIN || 'amg262';
const TOKEN = process.env.GITHUB_TOKEN;
const README = new URL('../../README.md', import.meta.url);

const START = '<!-- activity:start -->';
const END = '<!-- activity:end -->';

const QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!, $from30: DateTime!) {
  user(login: $login) {
    year: contributionsCollection(from: $from, to: $to) {
      totalPullRequestContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    recent: contributionsCollection(from: $from30, to: $to) {
      totalCommitContributions
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner }
      }
    }
  }
}`;

const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');
const num = (n) => n.toLocaleString('en-US');
const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;

// Consecutive days with at least one contribution, counting back from today.
// A quiet today doesn't break the streak — the day isn't over yet.
function streakFrom(weeks) {
  const days = weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i -= 1;
  let streak = 0;
  for (; i >= 0 && days[i].contributionCount > 0; i -= 1) streak += 1;
  return streak;
}

async function fetchActivity() {
  const to = new Date();
  const from = new Date(to.getTime() - 364 * 864e5);
  const from30 = new Date(to.getTime() - 30 * 864e5);

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${LOGIN}-profile-activity`,
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { login: LOGIN, from: iso(from), to: iso(to), from30: iso(from30) },
    }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors)}`);
  if (!body.data?.user) throw new Error(`No profile data for ${LOGIN}`);
  return body.data.user;
}

function render(user) {
  const { year, recent } = user;
  const streak = streakFrom(year.contributionCalendar.weeks);
  const repos = recent.commitContributionsByRepository.length;

  const chips = [];
  if (streak >= 2) chips.push(`${num(streak)}-day streak`);
  chips.push(`${plural(year.contributionCalendar.totalContributions, 'contribution')} · 12mo`);
  chips.push(`${plural(recent.totalCommitContributions, 'commit')} · 30d`);
  chips.push(`${plural(year.totalPullRequestContributions, 'PR')} · 12mo`);
  if (repos > 0) chips.push(`${plural(repos, 'repo')} · 30d`);

  return chips.map((c) => `\`${c}\``).join(' · ');
}

const user = await fetchActivity();
const block = `${START}\n${render(user)}\n${END}`;

const { readFile, writeFile } = await import('node:fs/promises');
const readme = await readFile(README, 'utf8');
const marked = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!marked.test(readme)) throw new Error('README.md is missing the activity markers');

const next = readme.replace(marked, block);
if (next === readme) {
  console.log('activity unchanged');
} else {
  await writeFile(README, next);
  console.log(`activity updated:\n${block}`);
}
