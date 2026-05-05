// Shared API request / response types. The real shapes are pinned by the
// sync protocol spec in iteration 4; today we only need the skeleton
// envelope that the placeholder handlers return.

export interface SkeletonResponse {
  ok: true;
  todo: 'iteration 5';
  route: 'push' | 'pull';
}
