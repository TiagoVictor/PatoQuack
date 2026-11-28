import { bitrateFor, constraintsFor, normalizeQuality, perViewerBitrate, uploadEstimate } from './quality';

describe('quality', () => {
  it('normaliza qualidades inválidas para o padrão do tipo', () => {
    expect(normalizeQuality('camera', { resolution: 'source', fps: 60 })).toEqual({ resolution: '720', fps: 60 });
    expect(normalizeQuality('screen', { resolution: 'x', fps: 7 })).toEqual({ resolution: '1080', fps: 15 });
  });

  it('60 FPS gasta mais banda e o teto é dividido entre quem assiste', () => {
    expect(bitrateFor({ resolution: '720', fps: 30 })).toBe(2_500_000);
    expect(bitrateFor({ resolution: '720', fps: 60 })).toBe(3_750_000);
    expect(perViewerBitrate({ resolution: '1080', fps: 30 }, 4, 10_000_000)).toBe(2_500_000);
    expect(perViewerBitrate({ resolution: '1080', fps: 30 }, 100, 10_000_000)).toBe(300_000); // mínimo útil
    expect(perViewerBitrate({ resolution: '1080', fps: 30 }, 4, 0)).toBe(4_500_000); // sem limite
    expect(uploadEstimate({ resolution: '720', fps: 30 }, 2, 0)).toContain('2 pessoas assistindo');
  });

  it('câmera usa ideal; tela usa max', () => {
    expect(constraintsFor('camera', { resolution: '1080', fps: 30 })).toEqual({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    expect(constraintsFor('screen', { resolution: '1080', fps: 15 })).toEqual({ height: { max: 1080 }, frameRate: { ideal: 15, max: 15 } });
  });
});
