import { onBeforeUnmount, onMounted } from 'vue';
import { requestExit } from './store';
import Toolbar from './components/Toolbar';
import Stage from './components/Stage';
import InspectorPanel from './components/InspectorPanel';

// Root of the canvas overlay. Fills the shadow-root host (fixed, full-viewport).
export default function App() {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      requestExit();
    }
  };
  onMounted(() => window.addEventListener('keydown', onKey, true));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));

  return (
    <div class="flex h-full w-full flex-col overflow-hidden bg-[#0b0e14] font-sans text-[13px] text-slate-200 antialiased">
      <Toolbar />
      <div class="flex min-h-0 flex-1">
        <Stage />
        <InspectorPanel />
      </div>
    </div>
  );
}
