import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { safeReturnUrl } from '../../../core/auth/auth.guards';
import { AuthStore } from '../../../core/auth/auth.store';
import { errorMessage } from '../../../core/util/error-message';
import { Button, Card, FormField, Label, TextInput } from '../../../shared/ui';

@Component({
  selector: 'pq-register-page',
  imports: [ReactiveFormsModule, RouterLink, Button, Card, FormField, Label, TextInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-card>
      <div pqCardHeader><h2 class="title">Criar conta</h2></div>
      <form [formGroup]="form" (ngSubmit)="submitAsync()">
        <pq-form-field label="Nome" for="name" required hint="Como você aparece nos canais de voz.">
          <input pqInput id="name" formControlName="name" maxlength="32" autocomplete="name" />
        </pq-form-field>
        <pq-form-field label="Usuário" for="username" required hint="3 a 32: letras minúsculas, números, _ ou .">
          <input pqInput id="username" formControlName="username" maxlength="32" autocomplete="username" />
        </pq-form-field>
        <pq-form-field label="E-mail" for="email" required>
          <input pqInput id="email" type="email" formControlName="email" autocomplete="email" />
        </pq-form-field>
        <pq-form-field label="Senha" for="new-password" required hint="Pelo menos 8 caracteres." [error]="error()">
          <input pqInput id="new-password" type="password" formControlName="password" autocomplete="new-password" />
        </pq-form-field>
        <button pqButton type="submit" variant="primary" block [loading]="busy()">Criar conta</button>
      </form>
      <pq-label tone="muted" size="sm" class="switch">
        Já tem conta? <a routerLink="/entrar" [queryParams]="voltar() ? { voltar: voltar() } : {}">Entrar</a>
      </pq-label>
    </pq-card>
  `,
  styleUrl: '../auth-card.css',
})
export class RegisterPage {
  readonly voltar = input<string>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(32)] }),
    username: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^@?[A-Za-z0-9_.]{3,32}$/)],
    }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submitAsync(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(this.firstProblem());
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const value = this.form.getRawValue();
      await this.auth.registerAsync({ ...value, name: value.name.trim(), username: value.username.trim() });
      await this.router.navigateByUrl(safeReturnUrl(this.voltar()));
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private firstProblem(): string {
    const c = this.form.controls;
    if (c.name.invalid) return 'Informe um nome de até 32 caracteres.';
    if (c.username.invalid) return 'Usuário: 3 a 32 caracteres, letras, números, _ ou .';
    if (c.email.invalid) return 'Informe um e-mail válido.';
    return 'A senha precisa ter pelo menos 8 caracteres.';
  }
}
