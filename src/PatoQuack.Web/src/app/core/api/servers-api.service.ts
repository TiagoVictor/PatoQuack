import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ChannelDto, CreateInviteRequest, InviteDto, MemberDto, ServerDto, ServerInviteDto, ServerSummaryDto,
} from './servers-api.models';

export const API_URL = new InjectionToken<string>('API_URL', {
  providedIn: 'root',
  factory: () => environment.apiUrl,
});

/** Cliente da API de servidores, canais e convites. Erros saem como HttpErrorResponse com ProblemDetails. */
@Injectable({ providedIn: 'root' })
export class ServersApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);
  private readonly serversUrl = `${this.apiUrl}/servers`;

  listServersAsync(): Promise<ServerSummaryDto[]> {
    return firstValueFrom(this.http.get<ServerSummaryDto[]>(this.serversUrl));
  }

  createServerAsync(name: string): Promise<ServerDto> {
    return firstValueFrom(this.http.post<ServerDto>(this.serversUrl, { name }));
  }

  getServerAsync(serverId: string): Promise<ServerDto> {
    return firstValueFrom(this.http.get<ServerDto>(`${this.serversUrl}/${serverId}`));
  }

  renameServerAsync(serverId: string, name: string): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`${this.serversUrl}/${serverId}`, { name }));
  }

  deleteServerAsync(serverId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.serversUrl}/${serverId}`));
  }

  createChannelAsync(serverId: string, name: string): Promise<ChannelDto> {
    return firstValueFrom(this.http.post<ChannelDto>(`${this.serversUrl}/${serverId}/channels`, { name }));
  }

  renameChannelAsync(serverId: string, channelId: string, name: string): Promise<ChannelDto> {
    return firstValueFrom(this.http.patch<ChannelDto>(`${this.serversUrl}/${serverId}/channels/${channelId}`, { name }));
  }

  deleteChannelAsync(serverId: string, channelId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.serversUrl}/${serverId}/channels/${channelId}`));
  }

  listMembersAsync(serverId: string): Promise<MemberDto[]> {
    return firstValueFrom(this.http.get<MemberDto[]>(`${this.serversUrl}/${serverId}/members`));
  }

  /** Sai do servidor (o dono não pode: recebe 409). */
  leaveServerAsync(serverId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.serversUrl}/${serverId}/leave`, null));
  }

  listInvitesAsync(serverId: string): Promise<ServerInviteDto[]> {
    return firstValueFrom(this.http.get<ServerInviteDto[]>(`${this.serversUrl}/${serverId}/invites`));
  }

  createInviteAsync(serverId: string, request: CreateInviteRequest): Promise<ServerInviteDto> {
    return firstValueFrom(this.http.post<ServerInviteDto>(`${this.serversUrl}/${serverId}/invites`, request));
  }

  revokeInviteAsync(inviteCode: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.apiUrl}/invites/${encodeURIComponent(inviteCode)}`));
  }

  getInviteAsync(inviteCode: string): Promise<InviteDto> {
    return firstValueFrom(this.http.get<InviteDto>(`${this.apiUrl}/invites/${encodeURIComponent(inviteCode)}`));
  }

  acceptInviteAsync(inviteCode: string): Promise<{ serverId: string }> {
    return firstValueFrom(
      this.http.post<{ serverId: string }>(`${this.apiUrl}/invites/${encodeURIComponent(inviteCode)}/accept`, null));
  }
}
