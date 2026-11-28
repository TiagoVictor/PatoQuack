import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ServerSummaryDto } from '../../../core/api/servers-api.models';
import { ServersApiService } from '../../../core/api/servers-api.service';
import { AuthStore } from '../../../core/auth/auth.store';
import { errorMessage } from '../../../core/util/error-message';
import { parseInviteCode } from '../../../core/util/invite-code';
import {
  Avatar, Badge, Button, Card, FormField, Grid, GridItem, Label, TextInput,
} from '../../../shared/ui';

/** Início: meus servidores, criar um servidor ou entrar por convite. */
@Component({
  selector: 'pq-home-page',
  imports: [
    ReactiveFormsModule, RouterLink, Avatar, Badge, Button, Card, FormField, Grid, GridItem, Label, TextInput,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  private readonly api = inject(ServersApiService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);

  protected readonly serverName = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(32), Validators.pattern(/\S/)],
  });
  protected readonly invite = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  // (ngSubmit) só existe em <form> com [formGroup].
  protected readonly createForm = new FormGroup({ name: this.serverName });
  protected readonly inviteForm = new FormGroup({ invite: this.invite });

  protected readonly servers = signal<ServerSummaryDto[] | null>(null);
  protected readonly serversError = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected readonly inviteError = signal<string | null>(null);

  protected readonly byId = (server: ServerSummaryDto) => server.id;

  constructor() {
    void this.loadServersAsync();
  }

  protected async createAsync(): Promise<void> {
    if (this.serverName.invalid) {
      this.serverName.markAsTouched();
      this.createError.set('Informe um nome de até 32 caracteres.');
      return;
    }

    this.creating.set(true);
    this.createError.set(null);
    try {
      const server = await this.api.createServerAsync(this.serverName.value.trim());
      // Vai direto para o canal padrão, pronto para entrar na voz.
      const [firstChannel] = server.channels;
      await this.router.navigate(firstChannel ? ['/s', server.id, 'c', firstChannel.id] : ['/s', server.id]);
    } catch (error) {
      this.createError.set(errorMessage(error));
    } finally {
      this.creating.set(false);
    }
  }

  protected async joinAsync(): Promise<void> {
    const code = parseInviteCode(this.invite.value);
    if (!code) {
      this.invite.markAsTouched();
      this.inviteError.set('Cole o código (8 caracteres) ou o link de convite.');
      return;
    }

    this.inviteError.set(null);
    await this.router.navigate(['/convite', code]);
  }

  private async loadServersAsync(): Promise<void> {
    try {
      this.servers.set(await this.api.listServersAsync());
    } catch (error) {
      this.serversError.set(errorMessage(error));
    }
  }
}
