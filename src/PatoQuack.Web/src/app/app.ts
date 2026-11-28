import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthStore } from './core/auth/auth.store';
import { VoiceRoomStore } from './features/voice/data/voice-room.store';
import { Avatar, Badge, Button, Label } from './shared/ui';

@Component({
  selector: 'pq-root',
  imports: [Avatar, Badge, Button, Label, RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly auth = inject(AuthStore);
  private readonly voice = inject(VoiceRoomStore);
  private readonly router = inject(Router);

  protected async logoutAsync(): Promise<void> {
    if (this.voice.inRoom()) await this.voice.leaveAsync();
    await this.auth.logoutAsync();
    await this.router.navigate(['/entrar']);
  }
}
