import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ServersApiService } from './servers-api.service';

describe('ServersApiService', () => {
  let api: ServersApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ServersApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('usa as rotas REST de servidores e canais', async () => {
    const created = api.createServerAsync('Amigos');
    const post = http.expectOne('/api/servers');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ name: 'Amigos' });
    post.flush({ id: 's1', name: 'Amigos', isOwner: true, permissions: [], channels: [] });
    expect((await created).id).toBe('s1');

    const renamed = api.renameChannelAsync('s1', 'c1', 'Jogos');
    const patch = http.expectOne('/api/servers/s1/channels/c1');
    expect(patch.request.method).toBe('PATCH');
    patch.flush({ id: 'c1', name: 'Jogos' });
    expect((await renamed).name).toBe('Jogos');

    const deleted = api.deleteServerAsync('s1');
    const del = http.expectOne('/api/servers/s1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    await deleted;
  });

  it('cria, lista e revoga convites do servidor', async () => {
    const created = api.createInviteAsync('s1', { expiresInDays: 1, maxUses: null });
    const post = http.expectOne('/api/servers/s1/invites');
    expect(post.request.body).toEqual({ expiresInDays: 1, maxUses: null });
    post.flush({ code: 'abcdefghjkmn', createdAt: '', expiresAt: '', maxUses: null, uses: 0 });
    expect((await created).code).toBe('abcdefghjkmn');

    const list = api.listInvitesAsync('s1');
    http.expectOne('/api/servers/s1/invites').flush([]);
    expect(await list).toEqual([]);

    const revoked = api.revokeInviteAsync('abcdefghjkmn');
    const del = http.expectOne('/api/invites/abcdefghjkmn');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    await revoked;
  });

  it('consulta e aceita convites', async () => {
    const preview = api.getInviteAsync('abcd2345');
    http.expectOne('/api/invites/abcd2345').flush({ serverId: 's1', serverName: 'Amigos', alreadyMember: false });
    expect((await preview).serverName).toBe('Amigos');

    const accepted = api.acceptInviteAsync('abcd2345');
    const post = http.expectOne('/api/invites/abcd2345/accept');
    expect(post.request.method).toBe('POST');
    post.flush({ serverId: 's1' });
    expect((await accepted).serverId).toBe('s1');
  });
});
