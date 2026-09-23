import React, { useEffect, useRef } from 'react';

export type VoiceSessionState = 'idle' | 'listening' | 'processing' | 'speaking' | 'interrupted';

interface VoiceOrbVisualizerProps {
  state: VoiceSessionState;
  audioLevel: number; // 0.0 to 1.0
  size?: number;
}

export const VoiceOrbVisualizer: React.FC<VoiceOrbVisualizerProps> = ({
  state,
  audioLevel,
  size = 220,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const audioLevelRef = useRef(audioLevel);

  stateRef.current = state;
  audioLevelRef.current = audioLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let time = 0;
    let smoothedLevel = 0;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const render = () => {
      time += 0.04;
      const currentState = stateRef.current;
      const targetLevel = audioLevelRef.current;
      smoothedLevel = smoothedLevel * 0.8 + targetLevel * 0.2;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, size, size);

      const centerX = size / 2;
      const centerY = size / 2;
      const baseRadius = size * 0.26;

      // Select colors based on state
      let primaryColor = 'rgba(56, 189, 248, '; // Cyan/Sky
      let secondaryColor = 'rgba(99, 102, 241, '; // Indigo
      let glowColor = 'rgba(56, 189, 248, 0.4)';

      if (currentState === 'processing') {
        primaryColor = 'rgba(245, 158, 11, '; // Amber
        secondaryColor = 'rgba(168, 85, 247, '; // Purple
        glowColor = 'rgba(245, 158, 11, 0.45)';
      } else if (currentState === 'speaking') {
        primaryColor = 'rgba(16, 185, 129, '; // Emerald
        secondaryColor = 'rgba(6, 182, 212, '; // Teal
        glowColor = 'rgba(16, 185, 129, 0.45)';
      } else if (currentState === 'interrupted') {
        primaryColor = 'rgba(244, 63, 94, '; // Rose / Coral
        secondaryColor = 'rgba(251, 146, 60, '; // Orange
        glowColor = 'rgba(244, 63, 94, 0.6)';
      }

      // Outer Ripple Waves (when speaking or listening)
      if (currentState === 'listening' || currentState === 'speaking') {
        const rippleCount = 3;
        for (let i = 0; i < rippleCount; i++) {
          const wavePhase = (time * 0.8 + i * 0.35) % 1;
          const rippleRadius = baseRadius + wavePhase * (size * 0.22) + smoothedLevel * 30;
          const rippleAlpha = (1 - wavePhase) * (0.2 + smoothedLevel * 0.4);

          ctx.beginPath();
          ctx.arc(centerX, centerY, Math.max(1, rippleRadius), 0, Math.PI * 2);
          ctx.strokeStyle = `${primaryColor}${rippleAlpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Processing Ring / Swirl
      if (currentState === 'processing') {
        const ringRadius = baseRadius + 14;
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(time * 2);
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, 0, Math.PI * 1.5);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }

      // Outer Glow
      const glowGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.6,
        centerX,
        centerY,
        baseRadius * 1.5 + smoothedLevel * 25
      );
      glowGrad.addColorStop(0, glowColor);
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 1.5 + smoothedLevel * 25, 0, Math.PI * 2);
      ctx.fill();

      // Fluid Morphed Orb Core
      const points = 8;
      const effectiveRadius = baseRadius + (currentState === 'speaking' ? Math.sin(time * 3) * 6 : 0) + smoothedLevel * 22;

      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        // Wobbly organic distortion
        const wobble = Math.sin(angle * 3 + time * 2) * (4 + smoothedLevel * 14);
        const r = effectiveRadius + wobble;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();

      // Core Gradient
      const coreGrad = ctx.createRadialGradient(
        centerX - baseRadius * 0.3,
        centerY - baseRadius * 0.3,
        baseRadius * 0.1,
        centerX,
        centerY,
        effectiveRadius
      );
      coreGrad.addColorStop(0, `${primaryColor}0.95)`);
      coreGrad.addColorStop(0.7, `${secondaryColor}0.8)`);
      coreGrad.addColorStop(1, `${primaryColor}0.4)`);

      ctx.fillStyle = coreGrad;
      ctx.fill();

      // Center Specular Highlight
      ctx.beginPath();
      ctx.arc(centerX - baseRadius * 0.3, centerY - baseRadius * 0.3, baseRadius * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fill();

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [size]);

  return (
    <div className="voice-orb-container" style={{ width: size, height: size, margin: '0 auto', position: 'relative' }}>
      <canvas ref={canvasRef} />
    </div>
  );
};
