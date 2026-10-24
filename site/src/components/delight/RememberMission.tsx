// Today page helper: remembers today's mission (localStorage, this browser) so the focus timer can offer
// its items on every page. Renders nothing. In TodayApp, after the mission is computed:
//   <RememberMission items={m.items.map((it) => ({ title: it.title, minutes: it.minutes, kind: it.kind, href }))} />
import { useEffect } from 'react';
import { rememberMission, type MissionHint } from '../../lib/pomodoro';

export default function RememberMission({ items }: { items: MissionHint[] }) {
  const key = JSON.stringify(items);
  useEffect(() => { rememberMission(JSON.parse(key) as MissionHint[]); }, [key]);
  return null;
}
