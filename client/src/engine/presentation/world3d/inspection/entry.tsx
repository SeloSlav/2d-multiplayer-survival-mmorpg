import ReactDOM from 'react-dom/client';
import EngineLab from './EngineLab';

const root = import.meta.hot?.data.inspectionRoot ?? ReactDOM.createRoot(document.getElementById('inspection-root')!);
if (import.meta.hot) import.meta.hot.data.inspectionRoot = root;
root.render(<EngineLab />);
