type Activity={id:string;round?:number;kind:string;state:"running"|"completed"|"error"};
export function summarizeActivities(activities:Activity[],running=false){
  const unique=[...new Map(activities.map(activity=>[activity.id,activity])).values()];
  const rounds=[...new Set(unique.map(activity=>activity.round??1))].sort((a,b)=>a-b);
  const state=unique.some(activity=>activity.state==="error")?"error":running||unique.some(activity=>activity.state==="running")?"running":"completed";
  return {roundCount:rounds.length,currentRound:rounds.at(-1)??0,toolCount:unique.filter(activity=>activity.kind==="tool").length,state};
}
