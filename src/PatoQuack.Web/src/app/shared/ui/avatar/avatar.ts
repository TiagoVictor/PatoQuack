import { ChangeDetectionStrategy, booleanAttribute, Component, computed, input } from '@angular/core';

export type AvatarSize = 'sm' | 'md' | 'lg';

/**
 * Avatar com a inicial do nome. `highlighted` acende um anel (ex.: falando);
 * `dimmed` esmaece (ex.: mutado).
 */
@Component({
  selector: 'pq-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ initial() }}`,
  styles: `
    :host {
      --size: 40px;
      width: var(--size); height: var(--size); flex: none; border-radius: 50%;
      display: grid; place-items: center; font-weight: 700; font-size: calc(var(--size) * .42);
      background: var(--pq-accent); color: var(--pq-text); user-select: none;
      box-shadow: 0 0 0 2px transparent; transition: box-shadow .12s ease, opacity .12s ease;
    }
    :host([data-size="sm"]) { --size: 28px; }
    :host([data-size="lg"]) { --size: 64px; }
    :host(.highlighted) { box-shadow: 0 0 0 3px var(--pq-success); }
    :host(.dimmed) { opacity: .6; }
  `,
  host: {
    role: 'img',
    '[attr.aria-label]': 'name()',
    '[attr.data-size]': 'size()',
    '[class.highlighted]': 'highlighted()',
    '[class.dimmed]': 'dimmed()',
  },
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input<AvatarSize>('md');
  readonly highlighted = input(false, { transform: booleanAttribute });
  readonly dimmed = input(false, { transform: booleanAttribute });

  protected readonly initial = computed(() => this.name().trim().slice(0, 1).toUpperCase() || '?');
}
