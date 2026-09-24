import { MarkdownMathRenderer as MathText } from '../../components/content/MarkdownMathRenderer';
import { parsePseudocode } from './mapModel';

type Props = {
  markdown: string;
  notes: boolean;
  focusedMechanism?: string | null;
  onMechanism: (id: string) => void;
};

export function PaperAlgorithm({markdown, notes, focusedMechanism, onMechanism}: Props) {
  const parts = markdown.split(/```algorithm\r?\n([\s\S]*?)```/g);
  const keyword = /^(Require|Input|Initialize|Snapshot|Freeze|for|if|while|end for|end if|end while|repeat|until)\b/;
  return <div className="rlPaperAlgorithm">{parts.map((part, index) => index % 2 === 0
    ? <MathText key={index}>{part}</MathText>
    : <div className="rlPseudocode" key={index} aria-label="Indented algorithm pseudocode">
      <div className="rlPseudocodeHeader">
        <strong>Procedure</strong><span>← assignment · indentation shows loop scope</span>
      </div>
      <ol className="rlPseudocodeLines">{parsePseudocode(part).map((line, i) =>
        <li key={i} className={`rlPseudoLine${focusedMechanism && line.mechanism === focusedMechanism ? ' rlPseudoHighlight' : ''}`}>
          <span className="rlLineNumber" aria-hidden="true">{i + 1}</span>
          <div className="rlPseudoBody" style={{paddingLeft: `${line.depth * 20}px`}}>
            <div className="rlPseudoStatement">
              <MathText>{line.text.replace(keyword, '**$1**')}</MathText>
              {line.mechanism ? <button type="button" className="rlMechanismMark"
                onClick={() => onMechanism(line.mechanism!)}
                title="Trace this mechanism across algorithms"
                aria-label={`Trace ${line.mechanism.replaceAll('-', ' ')} across algorithms`}>
                ↗ {line.mechanism.replaceAll('-', ' ')}
              </button> : null}
            </div>
            {notes && line.note ? <p className="rlStepNote">{line.note}</p> : null}
          </div>
        </li>)}</ol>
    </div>)}</div>;
}
