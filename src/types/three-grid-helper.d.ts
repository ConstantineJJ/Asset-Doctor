import 'three';

declare module 'three' {
  interface GridHelper {
    /** Runtime marker used by Asset Doctor helper cleanup. */
    isGridHelper?: boolean;
  }
}
