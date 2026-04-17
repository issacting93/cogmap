import { useState } from 'react';
import { useAppStore } from './store';
import MapTerrainView from './map/MapTerrainView';

export default function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const anchors = useAppStore((s) => s.anchors);

  return (
    <MapTerrainView
      nodes={anchors}
      selectedNodeId={selectedNodeId}
      onNodeClick={(id) => setSelectedNodeId(id)}
      onBackgroundClick={() => setSelectedNodeId(null)}
    />
  );
}
