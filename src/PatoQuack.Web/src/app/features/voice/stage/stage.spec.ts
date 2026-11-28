import { TestBed } from '@angular/core/testing';
import { RoomParticipant } from '../data/voice-room.models';
import { Stage } from './stage';

const person = (id: string, name: string, extra: Partial<RoomParticipant> = {}): RoomParticipant => ({
  id, name, muted: false, speaking: false, connection: 'connected', audio: null, isLocal: false, ...extra,
});

describe('Stage', () => {
  async function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(Stage);
    fixture.componentRef.setInput('participants', [person('local', 'Ana', { isLocal: true }), person('b', 'Bia', { muted: true })]);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('mostra a transmissão (para assistir) e os participantes em grade', async () => {
    const el = await render({ streamer: { id: 'b', name: 'Bia' }, streamerParticipantId: 'b' });

    const labels = [...el.querySelectorAll('.grid .tile')].map((t) => t.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Transmissão de Bia, ao vivo. Clique para assistir',
      'Ana (você)',
      'Bia, mutado',
    ]);
    expect(el.querySelector('.strip')).toBeNull();
  });

  it('ampliado: um bloco grande e o resto em miniatura; compacto: só miniaturas', async () => {
    const focused = await render({ focus: 'b' });
    expect(focused.querySelectorAll('.grid .tile').length).toBe(1);
    expect(focused.querySelectorAll('.strip .tile').length).toBe(1);

    TestBed.resetTestingModule();
    const compact = await render({ compact: true });
    expect(compact.querySelector('.grid')).toBeNull();
    expect(compact.querySelectorAll('.strip .tile').length).toBe(2);
  });
});
