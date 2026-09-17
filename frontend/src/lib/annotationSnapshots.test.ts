import { expect, test } from 'vitest';
import { sourcePageSnapshot } from './annotationSnapshots';
import type { Annotation } from '../types/tracker';
test('uses a question’s frozen primary and neighboring snapshots', () => {
  const question = { anchor: { pageNumber: 2, metadata: {
    annotatedPageImageUrl: '/page-2-old',
    annotatedPageImageUrls: {'1': '/page-1-frozen', '2': '/page-2-frozen'},
  }}} as unknown as Annotation;
  expect(sourcePageSnapshot([question], 1)).toBe('/page-1-frozen');
  expect(sourcePageSnapshot([question], 2)).toBe('/page-2-frozen');
  expect(sourcePageSnapshot([question], 3)).toBeNull();
});
test('legacy saved primary URLs remain readable', () => {
  const question = {anchor: {pageNumber: 2, metadata: {annotatedPageImageUrl:'/old?v=123'}}} as unknown as Annotation;
  expect(sourcePageSnapshot([question], 2)).toBe('/old?v=123');
  expect(sourcePageSnapshot([question], 1)).toBeNull();
});
