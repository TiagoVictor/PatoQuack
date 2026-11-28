import { Injectable, computed, inject, signal } from '@angular/core';
import { ChannelDto, MemberDto, ServerDto, ServerPermission } from '../../../core/api/servers-api.models';
import { ServersApiService } from '../../../core/api/servers-api.service';
import { errorMessage } from '../../../core/util/error-message';

/**
 * Estado do servidor aberto (rota /s/:serverId): dados, canais, permissões e as ações do dono.
 * Fornecido pelo ServerPage, então nasce e morre com a tela do servidor. As ações lançam Error com a mensagem
 * já legível, para o diálogo que as chamou mostrar.
 */
@Injectable()
export class ServerStore {
  private readonly api = inject(ServersApiService);

  private readonly _server = signal<ServerDto | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly server = this._server.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly channels = computed(() => this._server()?.channels ?? []);

  can(permission: ServerPermission): boolean {
    return this._server()?.permissions.includes(permission) ?? false;
  }

  channelById(id: string | null | undefined): ChannelDto | null {
    return this.channels().find((c) => c.id === id) ?? null;
  }

  async loadAsync(serverId: string): Promise<void> {
    if (this._server()?.id === serverId) return;
    this._loading.set(true);
    this._error.set(null);
    try {
      this._server.set(await this.api.getServerAsync(serverId));
    } catch (error) {
      this._server.set(null);
      this._error.set(errorMessage(error));
    } finally {
      this._loading.set(false);
    }
  }

  async createChannelAsync(name: string): Promise<ChannelDto> {
    const server = this.requireServer();
    const channel = await this.run(() => this.api.createChannelAsync(server.id, name));
    this.patch((s) => ({ ...s, channels: [...s.channels, channel] }));
    return channel;
  }

  async renameChannelAsync(channelId: string, name: string): Promise<void> {
    const server = this.requireServer();
    const channel = await this.run(() => this.api.renameChannelAsync(server.id, channelId, name));
    this.patch((s) => ({ ...s, channels: s.channels.map((c) => (c.id === channelId ? channel : c)) }));
  }

  async deleteChannelAsync(channelId: string): Promise<void> {
    const server = this.requireServer();
    await this.run(() => this.api.deleteChannelAsync(server.id, channelId));
    this.removeChannel(channelId);
  }

  /** Tira o canal da lista (apagado aqui ou avisado pelo hub). */
  removeChannel(channelId: string): void {
    this.patch((s) => ({ ...s, channels: s.channels.filter((c) => c.id !== channelId) }));
  }

  async renameServerAsync(name: string): Promise<void> {
    const server = this.requireServer();
    await this.run(() => this.api.renameServerAsync(server.id, name));
    this.patch((s) => ({ ...s, name }));
  }

  async listMembersAsync(): Promise<MemberDto[]> {
    const server = this.requireServer();
    return this.run(() => this.api.listMembersAsync(server.id));
  }

  async leaveServerAsync(): Promise<void> {
    const server = this.requireServer();
    await this.run(() => this.api.leaveServerAsync(server.id));
    this._server.set(null);
  }

  async deleteServerAsync(): Promise<void> {
    const server = this.requireServer();
    await this.run(() => this.api.deleteServerAsync(server.id));
    this._server.set(null);
  }

  private requireServer(): ServerDto {
    const server = this._server();
    if (!server) throw new Error('Nenhum servidor aberto.');
    return server;
  }

  private patch(update: (server: ServerDto) => ServerDto): void {
    this._server.update((s) => (s ? update(s) : s));
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw new Error(errorMessage(error));
    }
  }
}
