import type { Page } from '@playwright/test';

// Read existing viewer state through React's test-only DevTools hook. No product debug API.
export async function installViewerProbe(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true, renderers: new Map(),
      inject(renderer: unknown) { this.renderers.set(1, renderer); return 1; },
      getFiberRoots: () => new Set(), onScheduleFiberRoot: () => {}, onCommitFiberUnmount: () => {},
      onCommitFiberRoot: (_id: number, root: unknown) => Reflect.set(window, 'qaFiberRoot', root),
    } });
  });
}

export async function viewerState(page: Page, compare = false) {
  return page.evaluate(compare => {
    // Tauri's document initialization can precede CDP init scripts. Its existing
    // React container gives the same read-only root without altering the app.
    const container = document.getElementById('root');
    const key = container && Object.keys(container).find(k => k.startsWith('__reactContainer$'));
    const attached = container && key && Reflect.get(container,key);
    const roots = [Reflect.get(window, 'qaFiberRoot')?.current ?? attached?.stateNode?.current ?? attached];
    while (roots.length) {
      const fiber = roots.pop();
      if (!fiber) continue;
      if (fiber.child) roots.push(fiber.child);
      if (fiber.sibling) roots.push(fiber.sibling);
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const manager = hook.memoizedState?.current;
        if (!manager?.renderer || (compare ? !manager.assets : !manager.currentAssetRoot)) continue;
        const authored: any[] = compare ? manager.assets.map((a: any) => a.root) : [manager.currentAssetRoot];
        const issues: any[] = [];
        for (let state = fiber.memoizedState; state; state = state.next) {
          if (Array.isArray(state.memoizedState)) issues.push(...state.memoizedState.filter((x: any) => x?.category && x?.severity));
        }
        const snapshot = (o: any): {name:string;position:number[];quaternion:number[];scale:number[]} =>
          ({ name: o.name, position: o.position.toArray(), quaternion: o.quaternion.toArray(), scale: o.scale.toArray() });
        const skins: any[] = [];
        const pivots: ReturnType<typeof snapshot>[] = [];
        authored.forEach((r: any) => r.traverse((o: any) => {
          if (o.name === 'AuthoredPivot') pivots.push(snapshot(o));
          if (o.isSkinnedMesh) skins.push({joints:o.skeleton.bones.map((b: any)=>b.name),weights:Array.from(o.geometry.attributes.skinWeight.array),
            indices:Array.from(o.geometry.attributes.skinIndex.array),jointPosition:o.skeleton.bones[0].position.toArray()});
        }));
        return { roots: authored.map(snapshot), children: authored.map((r: any) => (r.children as any[]).map(snapshot)),
          issues: issues.filter(x => x.id.startsWith('transform-')).map(x => ({id:x.id,evidence:x.evidence,description:x.description})),
          wrapper: authored[0]?.parent && snapshot(authored[0].parent),
          bounds: manager.lastWholeModelInspection,
          skins, pivots, mixerOwnsAuthoredRoot: compare
            ? (manager.lineup?.roots ?? manager.slots).every((r: any)=>!r.mixer || r.mixer.getRoot() === (r.root ?? r.asset.root))
            : !manager.animationMixer || manager.animationMixer.getRoot() === authored[0],
        };
      }
    }
    return null;
  }, compare);
}
