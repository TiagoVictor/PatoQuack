import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MediaStreamDirective } from '../../../shared/media/media-stream';

/** Player da transmissão da sala, com legenda "ao vivo". */
@Component({
  selector: 'pq-stream-viewer',
  imports: [MediaStreamDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure>
      <video [pqMediaStream]="stream()" autoplay playsinline muted></video>
      <figcaption><span class="live-dot" aria-hidden="true"></span>{{ caption() }}</figcaption>
    </figure>
  `,
  styles: `
    figure {
      margin: 0; position: relative; border-radius: 8px; overflow: hidden;
      background: #000; aspect-ratio: 16 / 9;
    }
    video { width: 100%; height: 100%; object-fit: contain; display: block; }
    figcaption {
      position: absolute; left: 10px; bottom: 10px; display: flex; align-items: center; gap: 6px;
      background: rgb(0 0 0 / .65); padding: 4px 10px; border-radius: 999px; font-size: .8rem;
    }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pq-danger); }
  `,
})
export class StreamViewer {
  readonly stream = input<MediaStream | null>(null);
  readonly caption = input('');
}
