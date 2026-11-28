// Contratos da API REST (espelham PatoQuack.Server/Api/ServerContracts.cs).

/** Nomes das permissões (ServerPermission no C#, em camelCase). */
export type ServerPermission =
  | 'viewChannels'
  | 'connectVoice'
  | 'manageChannels'
  | 'manageServer'
  | 'manageInvites'
  | 'deleteServer'
  | 'sendMessages'
  | 'viewMembers';

export interface ChannelDto {
  id: string;
  name: string;
}

export interface ServerSummaryDto {
  id: string;
  name: string;
  isOwner: boolean;
}

export interface ServerDto {
  id: string;
  name: string;
  isOwner: boolean;
  permissions: ServerPermission[];
  channels: ChannelDto[];
}

export interface MemberDto {
  userId: string;
  name: string;
  username: string;
  isOwner: boolean;
}

/** Convite como o dono o vê. Link: /convite/{code}. */
export interface ServerInviteDto {
  code: string;
  createdAt: string;
  /** null = sem validade (convites antigos). */
  expiresAt: string | null;
  /** null = sem limite de usos. */
  maxUses: number | null;
  uses: number;
}

/** Validade 1, 7 ou 30 dias; usos 1, 10 ou null (sem limite). */
export interface CreateInviteRequest {
  expiresInDays: number;
  maxUses: number | null;
}

export interface InviteDto {
  serverId: string;
  serverName: string;
  alreadyMember: boolean;
}
