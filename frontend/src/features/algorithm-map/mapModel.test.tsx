import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import katex from 'katex';
import { MarkdownMathRenderer } from '../../components/content/MarkdownMathRenderer';
import { PaperAlgorithm } from './PaperAlgorithm';
import { actorExample, mapNodes, mapMechanisms, paperNotation, parsePseudocode } from './mapModel';

describe('paper algorithms and mathematical notation', () => {
  it('renders every authored card and both symbol conventions without math errors', () => {
    for (const node of mapNodes) for (const [section, content] of Object.entries(node.content)) {
      for (const text of [content, paperNotation(content, node.notation)]) {
        for (const match of text.matchAll(/\$\$([\s\S]*?)\$\$|(?<!\\)\$([^$\n]+)(?<!\\)\$/g)) {
          expect(() => katex.renderToString(match[1] ?? match[2], { throwOnError:true,strict:'error' }), `${node.id}: ${section}`).not.toThrow();
        }
        const html = renderToStaticMarkup(section === 'Algorithm'
          ? <PaperAlgorithm markdown={text} notes onMechanism={()=>{}}/>
          : <MarkdownMathRenderer>{text}</MarkdownMathRenderer>);
        expect(html, `${node.id}: ${section}`).not.toContain('katex-error');
        expect(html, `${node.id}: ${section}`).not.toContain('[@');
      }
    }
  });
  it('keeps all TD3 target updates inside the delayed actor block', () => {
    const body = mapNodes.find(n=>n.id==='td3')!.content.Algorithm.match(/```algorithm\n([\s\S]*?)```/)![1];
    const lines=parsePseudocode(body);
    const gate=lines.findIndex(l=>l.text.startsWith('if'));
    const end=lines.findIndex((l,i)=>i>gate&&l.text==='end if');
    const block=lines.slice(gate+1,end);
    expect(block).toHaveLength(3);
    expect(block.every(l=>l.depth===2)).toBe(true);
    expect(block[0].text).toContain('Q_{\\phi_1}');
    expect(block.slice(1).every(l=>l.mechanism==='targets')).toBe(true);
  });
  it('resolves every pseudocode mechanism tag', () => {
    const ids=new Set(mapMechanisms.map(m=>m.id));
    for(const node of mapNodes) for(const match of node.content.Algorithm.matchAll(/\[@([a-z-]+)\]/g)) expect(ids.has(match[1]),`${node.id}: ${match[1]}`).toBe(true);
  });
  it('swaps actor and critic notation simultaneously without altering state value symbols', () => {
    expect(paperNotation('\\theta, \\phi_1, \\psi, \\bar\\theta','swap')).toBe('\\phi, \\theta_1, \\psi, \\bar\\phi');
  });
});

describe('gradient demonstration', () => {
  const fd=(f:(x:number)=>number,x:number)=>(f(x+1e-5)-f(x-1e-5))/2e-5;
  it('holds the score action fixed and agrees with the log-density derivative', () => {
    const mean=0.2,sigma=0.7,A=-2;
    const actual=actorExample('score',mean,sigma,0,A);
    expect(actual.action).toBe(actorExample('score',1,sigma,0,A).action);
    expect(actual.gradient).toBeCloseTo(fd(mu=>A*(-((0.5-mu)**2)/(2*sigma**2)),mean),6);
  });
  it('holds noise fixed for pathwise mean and spread derivatives', () => {
    const mean=0.4,sigma=0.7,epsilon=-0.6;
    const objective=(mu:number,sd:number)=>4-(mu+sd*epsilon-2)**2+0.2*Math.log(sd);
    const actual=actorExample('sac',mean,sigma,epsilon,0);
    expect(actual.gradient).toBeCloseTo(fd(mu=>objective(mu,sigma),mean),6);
    expect(actual.sigmaGradient).toBeCloseTo(fd(sd=>objective(mean,sd),sigma),6);
  });
});
