import type { MutableRef } from '../types';
import {
  idleAnimationFrameRef,
  sprintAnimationFrameRef,
  walkingAnimationFrameRef,
} from '../../hooks/useAnimationCycle';
import { shakeOffsetXRef, shakeOffsetYRef, vignetteOpacityRef } from '../../hooks/useDamageEffects';
import { renderWardParticles } from '../../hooks/useWardParticles';
import { renderLateFramePasses } from '../frame/renderLateFramePasses';
import { renderWorldPreparationPasses } from '../frame/renderWorldPreparationPasses';
import { renderEntityWorldPasses } from '../frame/renderEntityWorldPasses';
import { renderScreenSpaceWorldEffects } from '../frame/renderScreenSpaceWorldEffects';
import type { GameCanvasRuntimeHost, GameCanvasRuntimeRenderRefs } from './GameCanvasRuntimeHost';
import type { GameCanvasRenderRuntimeConfig } from './assembleGameCanvasRenderContext';

interface ConfigureGameCanvasRenderRuntimeOptions
  extends Omit<
    GameCanvasRenderRuntimeConfig,
    'diagnostics' | 'animationRefs' | 'damageRefs' | 'renderFunctions' | 'gameCanvasRef' | 'renderRefs'
  > {
  gameCanvasRef: MutableRef<HTMLCanvasElement | null>;
  renderRefs: GameCanvasRuntimeRenderRefs;
  host: GameCanvasRuntimeHost;
}

export function configureGameCanvasRenderRuntime({
  host,
  ...config
}: ConfigureGameCanvasRenderRuntimeOptions) {
  const enableLagDiagnostics = false;
  const diagnostics = host.getRenderDiagnostics({
    localPlayer: config.localPlayer,
    enabled: enableLagDiagnostics,
  });

  host.configureRenderContextFromSnapshots({
    ...config,
    diagnostics,
    animationRefs: {
      walkingAnimationFrameRef,
      sprintAnimationFrameRef,
      idleAnimationFrameRef,
    },
    damageRefs: {
      shakeOffsetXRef,
      shakeOffsetYRef,
      vignetteOpacityRef,
    },
    renderFunctions: {
      renderWorldPreparationPasses,
      renderEntityWorldPasses,
      renderScreenSpaceWorldEffects,
      renderLateFramePasses,
      renderWardParticles,
    },
  });
}
