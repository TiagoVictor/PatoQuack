import { TestBed } from '@angular/core/testing';
import { Avatar } from './avatar';

describe('Avatar', () => {
  it('mostra a inicial e reflete os estados', async () => {
    const fixture = TestBed.createComponent(Avatar);
    fixture.componentRef.setInput('name', ' tiago');
    fixture.componentRef.setInput('highlighted', true);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent?.trim()).toBe('T');
    expect(host.getAttribute('aria-label')).toBe(' tiago');
    expect(host.classList).toContain('highlighted');
    expect(host.classList).not.toContain('dimmed');
  });
});
