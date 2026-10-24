// Static (server-rendered) book content with inline, themable figures.
import type { Block } from '../../lib/content-types';
import { Blocks, FigureContext } from './Blocks';

export function StaticBlocks({ blocks, figures = {} }: { blocks: Block[]; figures?: Record<string, string> }) {
  return (
    <FigureContext.Provider value={figures}>
      <Blocks blocks={blocks} />
    </FigureContext.Provider>
  );
}
