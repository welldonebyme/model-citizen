// One question in any of the 7 formats: format label, stem, answer area.
// `review` shows the learner's answer against the key (feedback, results); `locked` stops changes.
import type { Question } from '../../lib/content-types';
import type { Response } from '../../lib/scoring';
import type { DomcRules, DomcState } from '../../lib/exam/domc';
import { FORMAT_NAME, formatHint } from '../../lib/exam/describe';
import { Stem } from './Stem';
import { MultipleChoice, MultipleSelect } from './ChoiceList';
import { FillBlank } from './FillBlank';
import { Hotspot } from './Hotspot';
import { Matching } from './Matching';
import { BuildList } from './BuildList';
import { Domc, DomcReview } from './Domc';

export interface DomcProps { state: DomcState; rules: DomcRules; onJudge: (yes: boolean) => void; letters: boolean; keys?: boolean }

export interface QuestionViewProps {
  q: Question;
  response: Response | undefined;
  onResponse: (r: Response | undefined) => void;
  name: string;
  domc?: DomcProps;
  locked?: boolean;
  review?: boolean;
  /** exam screen: no copy buttons in code blocks */
  exam?: boolean;
  onEnter?: () => void;
}

export function QuestionView({ q, response, onResponse, name, domc, locked, review, exam, onEnter }: QuestionViewProps) {
  const lock = locked || review;
  const common = { q, response, onResponse, locked: lock, review, name };
  return (
    <div className="qz-q" data-format={q.format}>
      <p className="qz-meta">
        <span className="qz-fmt">{FORMAT_NAME[q.format]}</span>
        <span>{formatHint(q)}</span>
      </p>
      {q.format === 'fill' && <FillBlank {...common} hideCopy={exam} onEnter={onEnter} />}
      {q.format === 'hotspot' && <Hotspot {...common} hideCopy={exam} />}
      {q.format !== 'fill' && q.format !== 'hotspot' && <Stem blocks={q.stem} hideCopy={exam} />}
      {q.format === 'mc' && <MultipleChoice {...common} />}
      {q.format === 'ms' && <MultipleSelect {...common} />}
      {q.format === 'match' && <Matching {...common} />}
      {q.format === 'order' && <BuildList {...common} />}
      {q.format === 'domc' && domc && (review
        ? <DomcReview q={q} state={domc.state} />
        : <Domc q={q} state={domc.state} rules={domc.rules} onJudge={domc.onJudge} letters={domc.letters} keys={domc.keys} locked={lock} name={name} />)}
    </div>
  );
}
