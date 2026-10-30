import ReactDOM from 'react-dom/client';
import AnimationLab from './WeaponAnimationLab';

const root = import.meta.hot?.data.animationRoot ?? ReactDOM.createRoot(document.getElementById('animation-root')!);
if (import.meta.hot) import.meta.hot.data.animationRoot = root;
root.render(<AnimationLab />);
