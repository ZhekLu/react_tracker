import { ArrowRight, GitBranch } from 'lucide-react';
import { findNode, mapMechanisms } from './mapModel';
export function MechanismMap({selected,onSelect,onNode}:{selected:string;onSelect:(id:string)=>void;onNode:(id:string,mechanismId:string)=>void}) {
  const mechanism=mapMechanisms.find(item=>item.id===selected)??mapMechanisms[0];
  return <section className="rlMechanisms">
    <div className="rlSectionIntro"><h2>Follow an idea across papers</h2><p>Each connection says what was reused—and where its role changed. Select a mechanism, then open an algorithm at the step that uses it.</p></div>
    <div className="rlMechanismSelector" role="group" aria-label="Shared mechanism">{mapMechanisms.map(item=><button type="button" key={item.id} aria-pressed={item.id===mechanism.id} onClick={()=>onSelect(item.id)}>{item.title}</button>)}</div>
    <div className="rlMechanismHub"><GitBranch size={22}/><div><p className="rlEyebrow">ONE IDEA · DIFFERENT ROLES</p><h3>{mechanism.title}</h3><p>{mechanism.question}</p></div></div>
    <p className="rlMechanismSummary">{mechanism.summary}</p>
    <div className="rlMechanismUses" aria-label={`${mechanism.title} across algorithms`}>{mechanism.uses.map(use=><button type="button" key={use.node} onClick={()=>onNode(use.node,mechanism.id)}><span>{findNode(use.node)!.title}<ArrowRight size={14}/></span><p>{use.role}</p></button>)}</div>
    <div className="rlMechanismDistinction"><h4>Keep this distinction</h4><p>{mechanism.distinction}</p></div>
  </section>;
}
