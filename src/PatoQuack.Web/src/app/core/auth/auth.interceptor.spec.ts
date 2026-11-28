import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthStore } from './auth.store';

describe('authInterceptor', () => {
  it('401 na API limpa a sessão e manda para o login', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const clear = vi.spyOn(TestBed.inject(AuthStore), 'clearSession');
    const http = TestBed.inject(HttpTestingController);

    const request = firstValueFrom(TestBed.inject(HttpClient).get('/api/servers'));
    http.expectOne('/api/servers').flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(request).rejects.toBeTruthy();

    expect(clear).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/entrar'], { queryParams: { voltar: '/' } });
  });

  it('manda o cabeçalho de segurança só nas chamadas que mudam dados', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const client = TestBed.inject(HttpClient);

    void firstValueFrom(client.get('/api/servers'));
    void firstValueFrom(client.post('/api/servers', {}));
    expect(http.expectOne((r) => r.method === 'GET').request.headers.has('X-PatoQuack')).toBe(false);
    expect(http.expectOne((r) => r.method === 'POST').request.headers.get('X-PatoQuack')).toBe('1');
  });

  it('não interfere no login com senha errada', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    const http = TestBed.inject(HttpTestingController);

    const request = firstValueFrom(TestBed.inject(HttpClient).post('/api/auth/login', {}));
    http.expectOne('/api/auth/login').flush(null, { status: 401, statusText: 'Unauthorized' });
    await expect(request).rejects.toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
