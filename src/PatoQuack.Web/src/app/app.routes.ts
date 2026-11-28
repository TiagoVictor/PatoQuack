import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'entrar',
    title: 'Entrar · PatoQuack',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login-page/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'cadastro',
    title: 'Criar conta · PatoQuack',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register-page/register-page').then((m) => m.RegisterPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        title: 'PatoQuack',
        loadComponent: () => import('./features/servers/home-page/home-page').then((m) => m.HomePage),
      },
      {
        path: 'convite/:inviteCode',
        title: 'Convite · PatoQuack',
        loadComponent: () => import('./features/servers/invite-page/invite-page').then((m) => m.InvitePage),
      },
      {
        path: 's/:serverId',
        loadComponent: () => import('./features/servers/server-page/server-page').then((m) => m.ServerPage),
        children: [
          {
            path: '',
            loadComponent: () => import('./features/servers/server-page/server-page').then((m) => m.NoChannelSelected),
          },
          {
            path: 'c/:channelId',
            loadComponent: () => import('./features/servers/channel-page/channel-page').then((m) => m.ChannelPage),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
