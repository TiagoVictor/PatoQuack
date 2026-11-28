import { ChangeDetectionStrategy, Component, booleanAttribute, effect, inject, input, output, signal } from '@angular/core';
import { ServerInviteDto } from '../../../core/api/servers-api.models';
import { ServersApiService } from '../../../core/api/servers-api.service';
import { errorMessage } from '../../../core/util/error-message';
import { Badge, Button, Dialog, Label, Select, SelectOption } from '../../../shared/ui';

const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/**
 * "Convidar pessoas" (dono): gera um link com validade (1, 7 ou 30 dias) e limite de usos (1, até
 * 10 ou sem limite), copia, e lista os convites ativos com usos e vencimento, permitindo revogar.
 */
@Component({
  selector: 'pq-invite-dialog',
  imports: [Badge, Button, Dialog, Label, Select],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invite-dialog.html',
  styleUrl: './invite-dialog.css',
})
export class InviteDialog {
  readonly open = input(false, { transform: booleanAttribute });
  readonly serverId = input.required<string>();
  readonly serverName = input('');
  readonly closed = output<void>();

  private readonly api = inject(ServersApiService);

  protected readonly dayOptions: SelectOption<number>[] = [
    { value: 1, label: '1 dia' }, { value: 7, label: '7 dias' }, { value: 30, label: '30 dias' },
  ];
  // Select trabalha com string/number: 0 representa "sem limite" (null na API).
  protected readonly useOptions: SelectOption<number>[] = [
    { value: 1, label: '1 pessoa' }, { value: 10, label: 'até 10 pessoas' }, { value: 0, label: 'sem limite' },
  ];

  protected readonly days = signal(7);
  protected readonly uses = signal(10);
  protected readonly invites = signal<ServerInviteDto[] | null>(null);
  protected readonly created = signal<ServerInviteDto | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal<string | null>(null);

  constructor() {
    // Cada vez que abre: recarrega a lista e esquece o último link gerado.
    effect(() => {
      if (!this.open()) return;
      this.created.set(null);
      this.error.set(null);
      void this.loadAsync();
    });
  }

  protected link(code: string): string {
    return `${location.origin}/convite/${code}`;
  }

  protected usesText(invite: ServerInviteDto): string {
    return invite.maxUses === null ? `${invite.uses} ${invite.uses === 1 ? 'uso' : 'usos'} · sem limite` : `${invite.uses}/${invite.maxUses} usos`;
  }

  protected expiresText(invite: ServerInviteDto): string {
    if (!invite.expiresAt) return 'não expira';
    const ms = new Date(invite.expiresAt).getTime() - Date.now();
    const hours = Math.round(ms / 3_600_000);
    return hours < 48 ? `expira ${relative.format(hours, 'hour')}` : `expira ${relative.format(Math.round(hours / 24), 'day')}`;
  }

  protected async generateAsync(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const invite = await this.api.createInviteAsync(this.serverId(), {
        expiresInDays: this.days(),
        maxUses: this.uses() === 0 ? null : this.uses(),
      });
      this.created.set(invite);
      this.invites.update((list) => [invite, ...(list ?? [])]);
      await this.copyAsync(invite.code);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copyAsync(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link(code));
      this.copied.set(code);
      setTimeout(() => { if (this.copied() === code) this.copied.set(null); }, 2000);
    } catch {
      // Sem permissão de área de transferência: o link continua visível para copiar à mão.
    }
  }

  protected async revokeAsync(code: string): Promise<void> {
    this.error.set(null);
    try {
      await this.api.revokeInviteAsync(code);
      this.invites.update((list) => (list ?? []).filter((i) => i.code !== code));
      if (this.created()?.code === code) this.created.set(null);
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }

  private async loadAsync(): Promise<void> {
    this.invites.set(null);
    try {
      this.invites.set(await this.api.listInvitesAsync(this.serverId()));
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
}
