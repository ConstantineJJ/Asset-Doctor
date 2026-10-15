import type {PerformanceMemoryStats,PerformanceStageId,TopologyPerformanceStats} from '../types';

/** Explicit per-session observer; background verification uses the no-op sink. */
export interface MetricsSink {
 record(stage:PerformanceStageId,durationMs:number):void;
 setMemory(memory:Partial<PerformanceMemoryStats>):void;
 resetForAsset?(sourceGlbBytes:number,liveGeometryBytes:number):void;
 noteGeometryPassStart?(rootUuid:string):void;
 beginTopologyPhase?(rootUuid:string):void;
 completeAnalysisCycle?(rootUuid:string):void;
 cancelAnalysisCycle?(rootUuid?:string):void;
 setTopology?(metrics:TopologyPerformanceStats):void;
}
export const noMetrics:MetricsSink={record(){},setMemory(){}};
