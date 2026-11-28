import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL } from '../api/servers-api.service';
import { RegisterRequest, UserDto } from './auth.models';

/** Cliente de /api/auth. A sessão é um cookie HttpOnly: o JS nunca vê o token. */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${inject(API_URL)}/auth`;

  registerAsync(request: RegisterRequest): Promise<UserDto> {
    return firstValueFrom(this.http.post<UserDto>(`${this.baseUrl}/register`, request));
  }

  /** `login` aceita e-mail ou nome de usuário. */
  loginAsync(login: string, password: string): Promise<UserDto> {
    return firstValueFrom(this.http.post<UserDto>(`${this.baseUrl}/login`, { login, password }));
  }

  logoutAsync(): Promise<void> {
    return firstValueFrom(this.http.post<void>(`${this.baseUrl}/logout`, null));
  }

  meAsync(): Promise<UserDto> {
    return firstValueFrom(this.http.get<UserDto>(`${this.baseUrl}/me`));
  }
}
