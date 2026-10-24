// Static (server-rendered) book content with inline, themable figures and the links to the playgrounds.
import type { Block } from '../../lib/content-types';
import { Blocks, FigureContext, PlaygroundContext } from './Blocks';

export function StaticBlocks({ blocks, figures = {} }: { blocks: Block[]; figures?: Record<string, string> }) {
  return (
    <FigureContext.Provider value={figures}>
      <PlaygroundContext.Provider value={true}>
        <Blocks blocks={blocks} />
      </PlaygroundContext.Provider>
    </FigureContext.Provider>
  );
}
