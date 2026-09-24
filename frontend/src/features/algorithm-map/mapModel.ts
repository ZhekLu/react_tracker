import data from './map.generated.json';
export const sectionNames = ['Idea', 'Mechanics', 'Algorithm', 'Gradients', 'Paper trail', 'Recall'] as const;
export type Section = typeof sectionNames[number];
export type MapNode = {
  id: string; title: string; family: string; day: number; summary: string;
  overview?: boolean; core?: boolean; notation?: string;
  policy?: string; actions?: string; data?: string; value?: string;
  replay?: string; gradient?: string; control?: string;
  sources: { label: string; url?: string; resourceId?: string; page?: number }[];
  content: Record<Section,string>;
};
export const mapNodes = data.nodes as MapNode[];
export const mapEdges = data.edges;
export const mapMechanisms = data.mechanisms;
export function parsePseudocode(body: string) {
  return body.split('\n').filter(line => line.trim()).map(raw => {
    const depth = (raw.match(/^ */)?.[0].length ?? 0) / 2;
    const [statement, ...notes] = raw.trim().split(' :: ');
    const mechanism = statement.match(/ \[@([a-z-]+)\]$/)?.[1];
    return { depth, text: statement.replace(/ \[@[a-z-]+\]$/, ''), mechanism, note: notes.join(' :: ') };
  });
}
export const findNode = (id: string) => mapNodes.find(node => node.id === id);
export function paperNotation(text: string, notation?: string): string {
  if (notation === 'swap') return text.replace(/\\(theta|phi)(?![A-Za-z])/g, (_, symbol) => symbol === 'theta' ? '\\phi' : '\\theta');
  if (notation === 'ddpg') return text.replace(/\\(theta|phi)(?![A-Za-z])/g, (_, symbol) => symbol === 'theta' ? '\\theta^{\\mu}' : '\\theta^{Q}');
  return text;
}
export function actorExample(mode: string, mean: number, sigma: number, noise: number, advantage: number) {
  const action = mode === 'score' ? 0.5 : mode === 'sac' ? mean + sigma * noise : mean;
  const q = 4 - (action - 2) ** 2;
  const gradient = mode === 'score' ? advantage * (action - mean) / sigma ** 2 : 2 * (2-action);
  return { action, q, gradient, sigmaGradient: 0.2/sigma + 2*(2-action)*noise };
}
