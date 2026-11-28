import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { InviteDto } from '../../../core/api/servers-api.models';
import { ServersApiService } from '../../../core/api/servers-api.service';
import { errorMessage } from '../../../core/util/error-message';
import { Avatar, Button, Card, Label } from '../../../shared/ui';

/** Abre um link de convite: mostra o servidor e torna a pessoa membro com um clique. */
@Component({
  selector: 'pq-invite-page',
  imports: [RouterLink, Avatar, Button, Card, Label],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-card>
      @if (invite(); as invite) {
        <div class="invite">
          <pq-label tone="muted" size="sm">Você foi convidado para</pq-label>
          <pq-avatar [name]="invite.serverName" size="lg" />
          <h2 class="title">{{ invite.serverName }}</h2>
          @if (invite.alreadyMember) {
            <a pqButton variant="primary" block [routerLink]="['/s', invite.serverId]">Abrir servidor</a>
          } @else {
            <button pqButton type="button" variant="primary" block [loading]="busy()" (click)="acceptAsync()">
              Entrar no servidor
            </button>
          }
          @if (error()) {
            <pq-label tone="danger" size="sm" role="alert">{{ error() }}</pq-label>
          }
        </div>
      } @else if (error()) {
        <pq-label tone="danger">{{ error() }}</pq-label>
        <a pqButton routerLink="/">Voltar ao início</a>
      } @else {
        <pq-label tone="muted">Carregando convite…</pq-label>
      }
    </pq-card>
  `,
  styles: `
    :host { display: grid; justify-items: center; }
    pq-card { width: min(420px, 100%); }
    .invite { display: grid; justify-items: center; gap: var(--pq-space-3); text-align: center; }
    .title { margin: 0; font-size: 1.3rem; }
  `,
})
export class InvitePage {
  readonly inviteCode = input.required<string>();

  private readonly api = inject(ServersApiService);
  private readonly router = inject(Router);

  protected readonly invite = signal<InviteDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    effect(() => void this.loadAsync(this.inviteCode()));
  }

  protected async acceptAsync(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const { serverId } = await this.api.acceptInviteAsync(this.inviteCode());
      await this.router.navigate(['/s', serverId]);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async loadAsync(code: string): Promise<void> {
    this.invite.set(null);
    this.error.set(null);
    try {
      this.invite.set(await this.api.getInviteAsync(code));
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
}
