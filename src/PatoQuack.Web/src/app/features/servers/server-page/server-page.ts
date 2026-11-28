import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ChannelDto, MemberDto } from '../../../core/api/servers-api.models';
import {
  Avatar, Badge, Button, Card, ConfirmDialog, Dialog, Grid, GridItem, Label, PromptDialog, TextInput,
} from '../../../shared/ui';
import { ServerStore } from '../data/server.store';
import { InviteDialog } from '../invite-dialog/invite-dialog';

/** Placeholder do servidor quando nenhum canal está aberto (rota filha vazia). */
@Component({
  selector: 'pq-no-channel',
  imports: [Card, Label],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-card>
      <pq-label tone="muted">Escolha um canal de voz ao lado para entrar.</pq-label>
    </pq-card>
  `,
})
export class NoChannelSelected {}

type DialogState =
  | { kind: 'invite' }
  | { kind: 'members' }
  | { kind: 'leave-server' }
  | { kind: 'rename-server' }
  | { kind: 'delete-server' }
  | { kind: 'rename-channel'; channel: ChannelDto }
  | { kind: 'delete-channel'; channel: ChannelDto };

/**
 * Layout do servidor: cabeçalho, lista de canais e o canal aberto. As ações de gestão só
 * aparecem para quem tem a permissão (hoje, o dono); o servidor confere de novo em cada uma.
 */
@Component({
  selector: 'pq-server-page',
  imports: [
    ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet,
    Avatar, Badge, Button, Card, ConfirmDialog, Dialog, Grid, GridItem, InviteDialog, Label, PromptDialog, TextInput,
  ],
  // Fornecido no componente (e não na rota): o injetor de rota sobrevive à navegação e
  // reaproveitaria os dados de outra sessão. O canal (no router-outlet filho) enxerga este store.
  providers: [ServerStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './server-page.html',
  styleUrl: './server-page.css',
})
export class ServerPage {
  /** Parâmetro :serverId da rota. */
  readonly serverId = input.required<string>();

  protected readonly store = inject(ServerStore);
  private readonly router = inject(Router);

  protected readonly newChannel = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(32), Validators.pattern(/\S/)],
  });
  protected readonly newChannelForm = new FormGroup({ name: this.newChannel });
  protected readonly channelError = signal<string | null>(null);
  protected readonly creatingChannel = signal(false);

  protected readonly dialog = signal<DialogState | null>(null);
  protected readonly dialogBusy = signal(false);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly dialogChannel = computed(() => {
    const d = this.dialog();
    return d && 'channel' in d ? d.channel : null;
  });

  protected readonly members = signal<MemberDto[] | null>(null);

  protected readonly byId = (channel: ChannelDto) => channel.id;

  constructor() {
    effect(() => void this.store.loadAsync(this.serverId()));
  }

  protected async createChannelAsync(): Promise<void> {
    if (this.newChannel.invalid) {
      this.channelError.set('Informe um nome de até 32 caracteres.');
      return;
    }

    this.channelError.set(null);
    this.creatingChannel.set(true);
    try {
      const channel = await this.store.createChannelAsync(this.newChannel.value.trim());
      this.newChannel.reset();
      await this.router.navigate(['/s', this.serverId(), 'c', channel.id]);
    } catch (error) {
      this.channelError.set((error as Error).message);
    } finally {
      this.creatingChannel.set(false);
    }
  }

  // ---- diálogos --------------------------------------------------------

  protected openDialog(state: DialogState): void {
    this.dialogError.set(null);
    this.dialog.set(state);
  }

  protected closeDialog(): void {
    if (!this.dialogBusy()) this.dialog.set(null);
  }

  protected async openMembersAsync(): Promise<void> {
    this.members.set(null);
    this.openDialog({ kind: 'members' });
    try {
      this.members.set(await this.store.listMembersAsync());
    } catch (error) {
      this.dialogError.set((error as Error).message);
    }
  }

  protected leaveServerAsync(): Promise<void> {
    return this.runDialogAsync(async () => {
      await this.store.leaveServerAsync();
      await this.router.navigate(['/']);
    });
  }

  protected renameServerAsync(name: string): Promise<void> {
    return this.runDialogAsync(() => this.store.renameServerAsync(name));
  }

  protected deleteServerAsync(): Promise<void> {
    return this.runDialogAsync(async () => {
      await this.store.deleteServerAsync();
      await this.router.navigate(['/']);
    });
  }

  protected renameChannelAsync(name: string): Promise<void> {
    const channel = this.dialogChannel();
    return channel ? this.runDialogAsync(() => this.store.renameChannelAsync(channel.id, name)) : Promise.resolve();
  }

  protected deleteChannelAsync(): Promise<void> {
    const channel = this.dialogChannel();
    if (!channel) return Promise.resolve();
    return this.runDialogAsync(async () => {
      await this.store.deleteChannelAsync(channel.id);
      // Estava aberto: volta para o servidor (sair da tela do canal desliga a voz).
      if (this.router.url.includes(`/c/${channel.id}`)) {
        await this.router.navigate(['/s', this.serverId()]);
      }
    });
  }

  private async runDialogAsync(action: () => Promise<void>): Promise<void> {
    this.dialogBusy.set(true);
    this.dialogError.set(null);
    try {
      await action();
      this.dialogBusy.set(false);
      this.dialog.set(null);
    } catch (error) {
      this.dialogBusy.set(false);
      this.dialogError.set((error as Error).message);
    }
  }
}
