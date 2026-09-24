import { useState } from 'react';
import { MarkdownMathRenderer as MathText } from '../../components/content/MarkdownMathRenderer';
import { actorExample } from './mapModel';
const modes = [
  { id:'score', label:'PPO / REINFORCE', flow:['Actor weights θ','log πθ(fixed action | s)','× fixed advantage','Actor objective'], fixed:'The recorded action and advantage stay fixed.' },
  { id:'dpg', label:'DDPG / TD3', flow:['Actor weights θ','Action a = μθ(s)','Q: fixed weights, live input slope','Actor objective'], fixed:'State and critic weights stay fixed. The action moves.' },
  { id:'sac', label:'SAC', flow:['Actor weights θ','a = meanθ + σθ ε','Q(s,a) and log πθ(a | s)','Actor objective'], fixed:'State, critic weights, and this noise draw ε stay fixed. The action moves.' },
  { id:'critic', label:'Critic update', flow:['Critic weights φ','Qφ(fixed state, action)','Compare with detached y','Regression loss'], fixed:'The replay action and entire target stay fixed. Only Q weights change.' },
];
export function GradientLab() {
  const [mode,setMode] = useState('score');
  const [mean,setMean] = useState(0);
  const [sigma,setSigma] = useState(0.7);
  const [noise,setNoise] = useState(0.5);
  const [advantage,setAdvantage] = useState(2);
  const [prediction,setPrediction] = useState(1);
  const current = modes.find(item=>item.id===mode)!;
  const example = actorExample(mode, mean, sigma, noise, advantage);
  const left=40,right=575,top=20,bottom=184;
  const x=(a:number)=>left+(a+2)/6*(right-left);
  const density=(a:number)=>Math.exp(-0.5*((a-mean)/sigma)**2)/(sigma*Math.sqrt(2*Math.PI));
  const q=(a:number)=>4-(a-2)**2;
  const y=(v:number)=>mode==='score'?bottom-v/2*(bottom-top):bottom-(v+12)/17*(bottom-top);
  const curve=Array.from({length:151},(_,i)=>{const a=-2+6*i/150;return `${i?'L':'M'}${x(a).toFixed(2)},${y(mode==='score'?density(a):q(a)).toFixed(2)}`;}).join(' ');
  const activeValue=mode==='score'?density(example.action):q(example.action);
  const derivativeText=example.gradient>0.005?'Increase the actor mean':example.gradient< -0.005?'Decrease the actor mean':'Mean gradient is zero here';
  return <section className="rlGradientLab">
    <div className="rlSectionIntro"><h2>Same backpropagation. Different paths.</h2><p>First ask: which weights are being updated, and what is held fixed?</p></div>
    <div className="rlModeButtons" role="group" aria-label="Gradient method">{modes.map(item=><button key={item.id} type="button" aria-pressed={mode===item.id} onClick={()=>setMode(item.id)}>{item.label}</button>)}</div>
    <div className="rlGradientFlow" aria-label={current.flow.join(' → ')}>{current.flow.map((step,index)=><div key={step}><span>{index+1}</span><strong>{step}</strong>{index<3?<b aria-hidden="true">→</b>:null}</div>)}</div>
    <p className="rlFixed"><strong>Hold fixed:</strong> {current.fixed}</p>
    {mode==='critic'?<div className="rlToy"><h3>A fixed target is a label for this step</h3>
      <label>Current Q prediction: {prediction.toFixed(1)}<input aria-label="Current Q prediction" type="range" min="-1" max="7" step="0.1" value={prediction} onChange={e=>setPrediction(Number(e.target.value))}/></label>
      <MathText>{`$$y=3,\\quad L=\\tfrac12(Q_\\phi-3)^2,\\quad \\frac{\\partial L}{\\partial Q_\\phi}=${(prediction-3).toFixed(1)}.$$`}</MathText>
      <p aria-live="polite">Gradient descent pushes the prediction {prediction<3?'up toward 3':prediction>3?'down toward 3':'nowhere: it already matches 3'}. Multiply this residual by the network’s parameter derivative to update its weights.</p><p>The label y can depend on learned target networks and an actor when it is constructed. Detaching it means we do not optimize those paths in this critic step.</p>
    </div>:<div className="rlToyGrid"><div className="rlToy">
      <h3>{mode==='score'?'A fixed action under a changing density':'An actor output on a fixed value surface'}</h3>
      <svg viewBox="0 0 600 220" role="img" aria-label={mode==='score'?'Gaussian density over actions. The selected action stays at 0.5 as the mean changes.':'Illustrative quadratic Q surface. The actor action moves as parameters change.'}>
        <line x1={left} y1={bottom} x2={right} y2={bottom} className="rlAxis"/>
        {[-2,0,2,4].map(a=><g key={a}><line x1={x(a)} y1={bottom} x2={x(a)} y2={bottom+5} className="rlAxis"/><text x={x(a)} y={bottom+20} textAnchor="middle">{a}</text></g>)}
        <path d={curve} fill="none" className="rlCurve"/><line x1={x(example.action)} x2={x(example.action)} y1={bottom} y2={y(activeValue)} className="rlGuide"/><circle cx={x(example.action)} cy={y(activeValue)} r="5" className="rlPoint"/>
        <text x={left} y={15}>{mode==='score'?'Policy density':'Q(s,a) = 4 − (a − 2)²'}</text><text x={right} y={219} textAnchor="end">action a</text>
      </svg>
      <p className="rlToyCaption">Illustrative one-state example, not an experimental result. {mode==='score'?'Moving the mean changes how probable the same recorded action is.':'The curve stays fixed during the actor step; we use its slope to move the action.'}</p>
    </div><div className="rlToyControls">
      <label>Actor mean θ: {mean.toFixed(2)}<input aria-label="Actor mean" type="range" min="-0.5" max="2.5" step="0.05" value={mean} onChange={e=>setMean(Number(e.target.value))}/></label>
      {mode==='score'?<div className="rlModeButtons" role="group" aria-label="Advantage"><button type="button" aria-pressed={advantage>0} onClick={()=>setAdvantage(2)}>Good outcome: A = +2</button><button type="button" aria-pressed={advantage<0} onClick={()=>setAdvantage(-2)}>Bad outcome: A = −2</button></div>:null}
      {mode==='sac'?<><label>Policy spread σ: {sigma.toFixed(2)}<input aria-label="Policy spread" type="range" min="0.3" max="1" step="0.05" value={sigma} onChange={e=>setSigma(Number(e.target.value))}/></label><label>Fixed noise draw ε: {noise.toFixed(2)}<input aria-label="Noise draw" type="range" min="-1" max="1" step="0.05" value={noise} onChange={e=>setNoise(Number(e.target.value))}/></label></>:null}
      <div className="rlNumericResult" aria-live="polite"><strong>{derivativeText}</strong><span>Action = {example.action.toFixed(2)} · ascent gradient = {example.gradient.toFixed(2)}</span></div>
      <MathText>{mode==='score'?`$$g_\\theta=A\\frac{a-\\theta}{\\sigma^2},\\quad a=0.5,\\quad \\sigma=${sigma.toFixed(2)}.$$`:mode==='sac'?'$$a=\\theta+\\sigma\\epsilon,\\quad g_\\theta=2(2-a).$$':'$$a=\\theta,\\quad g_\\theta=\\underbrace{2(2-a)}_{Q\\text{ action slope}}\\underbrace{1}_{\\text{actor derivative}}.$$'}</MathText>
      {mode==='score'?<p>This is the unclipped score signal; PPO adds its ratio and clipping. The action is a fixed observation in this derivative.</p>:mode==='sac'?<><p>For this unsquashed Gaussian with fixed σ, shifting the mean leaves entropy unchanged: the explicit and action-path log-density terms cancel. The Q path remains.</p><MathText>{`$$g_\\sigma=\\frac{0.2}{\\sigma}+2(2-a)\\epsilon=${example.sigmaGradient.toFixed(2)}.$$`}</MathText><p>The spread gradient contains the entropy incentive (α = 0.2). Real SAC adds tanh and its density correction; see its card.</p></>:<p>A frozen critic still has a slope with respect to its input. Do not detach its output when computing the actor loss.</p>}
    </div></div>}
    <details className="rlDisclosure"><summary>Why no derivative through the environment?</summary><p>Score estimators use sampled returns or advantages as weights. DDPG/TD3/SAC use a learned differentiable Q as a local surrogate for action quality. None of these update rules differentiates through the real transition dynamics.</p><p><strong>A reliable derivative of an unreliable critic can still be misleading.</strong> This leads directly to TD3’s stabilizers and the offline coverage problem.</p></details>
  </section>;
}
