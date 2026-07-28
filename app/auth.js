(function initializeAuth(global) {
  const client = global.EsepSupabase;
  const loading = document.getElementById('authLoading');
  const authShell = document.getElementById('authShell');
  const appShells = document.querySelectorAll('.app-shell');
  const pendingEmailKey = 'esep-pending-confirmation-email';
  const pendingInviteKey = 'esep-pending-invitation';
  const resendButton = document.getElementById('resendConfirmation');
  const teamModal = document.getElementById('teamModal');
  const views = {
    login: document.getElementById('authLogin'),
    signup: document.getElementById('authSignup'),
    forgot: document.getElementById('authForgot'),
    updatePassword: document.getElementById('authUpdatePassword'),
    onboarding: document.getElementById('authOnboarding'),
  };
  let routeVersion = 0;

  function invitationToken() {
    const token = new URLSearchParams(location.search).get('invite');
    if (token) sessionStorage.setItem(pendingInviteKey, token);
    return token || sessionStorage.getItem(pendingInviteKey);
  }

  function authRedirectUrl() {
    const url = new URL('./index.html', location.href);
    const token = invitationToken();
    if (token) url.searchParams.set('invite', token);
    return url.href;
  }

  function clearInvitation() {
    sessionStorage.removeItem(pendingInviteKey);
    const url = new URL(location.href);
    url.searchParams.delete('invite');
    history.replaceState({}, '', url);
  }

  function showView(name) {
    Object.entries(views).forEach(([key, element]) => { element.hidden = key !== name; });
    authShell.hidden = false;
    loading.hidden = true;
    appShells.forEach((element) => { element.hidden = true; });
    clearMessages(views[name]);
    if (name === 'login') resendButton.hidden = !sessionStorage.getItem(pendingEmailKey);
  }

  function showApp() {
    authShell.hidden = true;
    loading.hidden = true;
    appShells.forEach((element) => { element.hidden = false; });
  }

  function showLoading() {
    loading.hidden = false;
    authShell.hidden = true;
    appShells.forEach((element) => { element.hidden = true; });
  }

  function clearMessages(root) {
    root?.querySelectorAll('[data-auth-error],[data-auth-success]').forEach((element) => { element.textContent = ''; });
  }

  function setMessage(form, type, message) {
    const target = form.querySelector(`[data-auth-${type}]`);
    if (target) target.textContent = message;
  }

  function setSubmitting(form, submitting) {
    form.querySelectorAll('input,button').forEach((element) => { element.disabled = submitting; });
  }

  function authError(error) {
    const message = String(error?.message || 'Не удалось выполнить запрос.');
    if (/invalid login credentials/i.test(message)) return 'Неверный email или пароль.';
    if (/user already registered/i.test(message)) return 'Аккаунт с таким email уже существует.';
    if (/email not confirmed/i.test(message)) return 'Подтвердите email по ссылке из письма.';
    const minimumLength = message.match(/password should be at least (\d+) characters/i);
    if (minimumLength) return `Пароль должен содержать минимум ${minimumLength[1]} символов.`;
    if (/password should contain at least one character of each/i.test(message)) {
      return 'Добавьте в пароль строчную и заглавную буквы, цифру и специальный символ.';
    }
    if (/password/i.test(message) && /weak|strength|requirements/i.test(message)) {
      return 'Пароль слишком простой. Используйте буквы разного регистра, цифру и специальный символ.';
    }
    if (/rate limit/i.test(message)) return 'Слишком много попыток. Попробуйте немного позже.';
    return message;
  }

  async function loadWorkspace(user, version) {
    let { data: membership, error: membershipError } = await client
      .from('memberships')
      .select('business_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (version !== routeVersion) return;
    if (membershipError) throw membershipError;
    if (!membership) {
      const token = invitationToken();
      if (token) {
        const { error: invitationError } = await client.rpc('accept_staff_invitation', { invitation_token: token });
        if (invitationError) {
          showView('onboarding');
          setMessage(document.getElementById('onboardingForm'), 'error', teamError(invitationError));
          return;
        }
        clearInvitation();
        const membershipResult = await client.from('memberships').select('business_id, role').eq('user_id', user.id).single();
        if (membershipResult.error) throw membershipResult.error;
        membership = membershipResult.data;
      } else {
        showView('onboarding');
        return;
      }
    }

    const [
      { data: business, error: businessError },
      { data: profile, error: profileError },
      { data: locationData, error: locationError },
    ] = await Promise.all([
      client.from('businesses').select('name').eq('id', membership.business_id).single(),
      client.from('profiles').select('full_name').eq('id', user.id).single(),
      client.from('locations').select('id,name').eq('business_id', membership.business_id).order('created_at').limit(1).single(),
    ]);
    if (version !== routeVersion) return;
    if (businessError) throw businessError;
    if (profileError) throw profileError;
    if (locationError) throw locationError;

    document.getElementById('businessName').textContent = business.name;
    document.getElementById('locationName').textContent = locationData.name;
    document.getElementById('profileName').textContent = profile.full_name || 'Пользователь';
    document.getElementById('profileEmail').textContent = user.email || '';
    await global.EsepApp?.loadCloudLocation(locationData.id);
    global.EsepApp?.setRole(membership.role);
    showApp();
  }

  async function routeSession(session) {
    const version = ++routeVersion;
    if (!session?.user) {
      showView(invitationToken() ? 'signup' : 'login');
      return;
    }
    showLoading();
    try {
      await loadWorkspace(session.user, version);
    } catch (error) {
      if (version !== routeVersion) return;
      showView('login');
      setMessage(document.getElementById('loginForm'), 'error', 'Не удалось загрузить кофейню. Попробуйте войти снова.');
    }
  }

  document.querySelectorAll('[data-auth-view]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.authView));
  });

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    clearMessages(form);
    setSubmitting(form, true);
    const { error } = await client.auth.signInWithPassword({
      email: String(values.get('email')).trim(),
      password: String(values.get('password')),
    });
    if (error) setMessage(form, 'error', authError(error));
    setSubmitting(form, false);
  });

  document.getElementById('signupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    clearMessages(form);
    setSubmitting(form, true);
    const email = String(values.get('email')).trim();
    const { data, error } = await client.auth.signUp({
      email,
      password: String(values.get('password')),
      options: {
        data: { full_name: String(values.get('fullName')).trim() },
        emailRedirectTo: authRedirectUrl(),
      },
    });
    if (error) {
      setMessage(form, 'error', authError(error));
    } else if (!data.session) {
      sessionStorage.setItem(pendingEmailKey, email);
      showView('login');
      setMessage(document.getElementById('loginForm'), 'success', `Мы отправили письмо на ${email}. Подтвердите email и войдите.`);
    }
    setSubmitting(form, false);
  });

  resendButton.addEventListener('click', async () => {
    const email = sessionStorage.getItem(pendingEmailKey);
    if (!email) return;
    const form = document.getElementById('loginForm');
    clearMessages(form);
    resendButton.disabled = true;
    const { error } = await client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) setMessage(form, 'error', authError(error));
    else setMessage(form, 'success', 'Письмо отправлено повторно. Проверьте также папку «Спам».');
    setTimeout(() => { resendButton.disabled = false; }, 60000);
  });

  document.getElementById('forgotForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get('email')).trim();
    clearMessages(form);
    setSubmitting(form, true);
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('./index.html', location.href).href,
    });
    if (error) setMessage(form, 'error', authError(error));
    else setMessage(form, 'success', 'Ссылка отправлена. Проверьте почту.');
    setSubmitting(form, false);
  });

  document.getElementById('updatePasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = String(new FormData(form).get('password'));
    clearMessages(form);
    setSubmitting(form, true);
    const { error } = await client.auth.updateUser({ password });
    if (error) setMessage(form, 'error', authError(error));
    else {
      const { data } = await client.auth.getSession();
      await routeSession(data.session);
    }
    setSubmitting(form, false);
  });

  document.getElementById('onboardingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    clearMessages(form);
    setSubmitting(form, true);
    const { error } = await client.rpc('create_business_with_owner', {
      business_name: String(values.get('businessName')).trim(),
      location_name: String(values.get('locationName')).trim(),
    });
    if (error) setMessage(form, 'error', authError(error));
    else {
      const { data } = await client.auth.getSession();
      await routeSession(data.session);
    }
    setSubmitting(form, false);
  });

  function teamError(error) {
    const message = String(error?.message || 'Не удалось выполнить операцию.');
    if (/invalid email/i.test(message)) return 'Проверьте адрес электронной почты.';
    if (/already a team member/i.test(message)) return 'Этот пользователь уже состоит в команде.';
    if (/invalid or expired/i.test(message)) return 'Ссылка недействительна или уже истекла.';
    if (/another email/i.test(message)) return 'Ссылка создана для другого email.';
    return authError(error);
  }

  async function loadTeam() {
    const root = document.getElementById('teamList');
    root.innerHTML = '<div class="muted" style="padding:14px">Загружаем команду…</div>';
    const { data, error } = await client.rpc('get_team_members');
    if (error) {
      root.innerHTML = '';
      const message = document.createElement('div');
      message.className = 'auth-error';
      message.textContent = teamError(error);
      root.appendChild(message);
      return;
    }
    root.innerHTML = '';
    data.forEach((member) => {
      const row = document.createElement('div');
      row.className = 'team-member';
      const avatar = document.createElement('div');
      avatar.className = 'team-avatar';
      avatar.textContent = (member.full_name || member.email || 'Э').trim().charAt(0).toUpperCase();
      const copy = document.createElement('div');
      copy.className = 'team-copy';
      const name = document.createElement('b');
      name.textContent = member.full_name || 'Без имени';
      const email = document.createElement('span');
      email.textContent = member.email;
      copy.append(name, email);
      const role = document.createElement('div');
      role.className = 'team-role';
      role.textContent = member.role === 'owner' ? 'Владелец' : 'Бариста';
      row.append(avatar, copy, role);
      if (!member.is_current && member.role === 'barista') {
        const remove = document.createElement('button');
        remove.className = 'remove-member';
        remove.type = 'button';
        remove.textContent = 'Удалить доступ';
        remove.addEventListener('click', async () => {
          if (!confirm(`Удалить доступ для ${member.full_name || member.email}?`)) return;
          remove.disabled = true;
          const { error: removeError } = await client.rpc('remove_team_member', { target_user_id: member.user_id });
          if (removeError) global.EsepApp?.showToast('Доступ не удалён', teamError(removeError));
          await loadTeam();
        });
        row.appendChild(remove);
      }
      root.appendChild(row);
    });
  }

  document.getElementById('manageTeam').addEventListener('click', async () => {
    document.getElementById('accountMenu').hidden = true;
    document.getElementById('accountToggle').setAttribute('aria-expanded', 'false');
    document.getElementById('inviteLinkBox').hidden = true;
    teamModal.showModal();
    await loadTeam();
  });
  document.getElementById('teamModalClose').addEventListener('click', () => teamModal.close());
  teamModal.addEventListener('cancel', (event) => { event.preventDefault(); teamModal.close(); });

  document.getElementById('inviteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get('email')).trim();
    const errorBox = form.querySelector('[data-team-error]');
    const submit = form.querySelector('button[type="submit"]');
    errorBox.textContent = '';
    submit.disabled = true;
    const { data: token, error } = await client.rpc('create_staff_invitation', { invited_email: email });
    submit.disabled = false;
    if (error) { errorBox.textContent = teamError(error); return; }
    const link = new URL('./index.html', location.href);
    link.searchParams.set('invite', token);
    document.getElementById('inviteLink').value = link.href;
    document.getElementById('inviteLinkBox').hidden = false;
    form.reset();
  });

  document.getElementById('copyInvite').addEventListener('click', async () => {
    const input = document.getElementById('inviteLink');
    try {
      await navigator.clipboard.writeText(input.value);
      global.EsepApp?.showToast('Ссылка скопирована', 'Отправьте её бариста удобным способом.');
    } catch (error) {
      input.select();
      document.execCommand('copy');
    }
  });

  async function signOut() {
    showLoading();
    const { error } = await client.auth.signOut();
    if (error) {
      showApp();
      global.EsepApp?.showToast('Не удалось выйти', authError(error));
    }
  }

  document.getElementById('signOut').addEventListener('click', signOut);
  document.getElementById('onboardingSignOut').addEventListener('click', signOut);

  if (!client) {
    loading.innerHTML = '<div class="auth-fatal"><b>Не удалось загрузить вход</b><span>Проверьте интернет и обновите страницу.</span></div>';
    return;
  }

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      showView('updatePassword');
      return;
    }
    if (event === 'SIGNED_IN') sessionStorage.removeItem(pendingEmailKey);
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => routeSession(session), 0);
  });

  client.auth.getSession().then(({ data, error }) => {
    if (error) showView('login');
    else routeSession(data.session);
  });
})(globalThis);
