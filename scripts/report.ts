// Relatório do teste: números de uso e respostas da pesquisa de cada testador.
// NÃO lê conversas, nomes de tarefas nem valores de dinheiro: só contadores, aparelho e a pesquisa.
// Roda no GitHub Actions (workflow "Relatório do teste", botão Run workflow) e escreve o resultado em anotações.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
const keys: { name: string; type?: string; api_key: string }[] = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const service = keys.find((k) => k.name === 'service_role' || k.type === 'secret')!.api_key;
console.log(`::add-mask::${service}`);
const H = service.startsWith('sb_') ? { apikey: service } : { apikey: service, Authorization: `Bearer ${service}` };
const get = async (path: string) => (await fetch(`https://${REF}.supabase.co/rest/v1/${path}`, { headers: H })).json();

const states: { user_id: string; data: any; updated_at: string }[] = await get('states?select=user_id,data,updated_at');
const owners = new Set(((await get('owners?select=user_id')) as any[]).map((o) => o.user_id));
const pushLog: any[] = await get(`push_log?select=user_id,at,kind,status,ok,gone&at=gte.${new Date(Date.now() - 14 * 864e5).toISOString()}&order=at.desc&limit=5000`);
const livres = new Set(((await get('unlimited?select=user_id')) as any[]).map((o) => o.user_id));
const aiLog: any[] = await get(`ai_log?select=at,status,stop,ms,out_tokens,model&at=gte.${new Date(Date.now() - 14 * 864e5).toISOString()}&order=at.desc&limit=5000`);
const subs = new Set(((await get('subs?select=user_id')) as any[]).map((s) => s.user_id));
const reports: any[] = await get('reports?select=user_id,text,ctx,created_at&order=created_at.asc');

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

const pessoas = states
  .filter((s) => s.data?.onboarded)
  .map((s) => {
    const d = s.data, st = d.stats || {};
    return {
      nome: String(d.name || '').trim().split(/\s+/)[0] || '(sem nome)',
      dono: owners.has(s.user_id),
      semLimite: livres.has(s.user_id),
      contaGoogle: !!d.account?.google,
      respostaAoPedirAvisos: st.pushAsk?.resposta || null,
      reinscricoes: st.pushResub || 0,
      avisos14dias: (() => { const l = pushLog.filter((x) => x.user_id === s.user_id); return { entregues: l.filter((x) => x.ok).length, recusados: l.filter((x) => !x.ok).length, ultimo: l[0] ? `${l[0].at.slice(0, 16)} ${l[0].ok ? 'ok' : 'erro ' + l[0].status}${l[0].gone ? ' (inscrição apagada)' : ''}` : null }; })(),
      inicio: d.startDate || [...(st.days || [])].sort()[0] || null,
      ultimoUso: s.updated_at.slice(0, 10),
      aparelho: st.device || '?',
      avisosLigados: subs.has(s.user_id),
      testeDeAviso: st.pushTest || 'não fez',
      diasUsados: (st.days || []).length,
      dias: st.days || [],
      pedidos: st.requests || 0,
      iaFalhas: st.aiFail || 0,
      // motivo de cada falha (só o tipo: cortada, formato, servidor_..., rede); conta antes de 4/11 não tem motivo
      iaFalhasPorMotivo: st.aiFailWhy || {},
      // o que a pessoa tentou fazer, só o tipo (tarefa, rotina, contas...); conta antes de 5/11 não tem
      tiposDePedido: st.kinds || {},
      planosConfirmados: st.confirmed || 0,
      ajustados: st.adjusted || 0,
      desfeitos: st.undone || 0,
      tarefasConcluidas: st.tasksDone || 0,
      avisosAbertos: st.opened || 0,
      adiados: st.snoozed || 0,
      voz: st.voice || 0,
      lugares: st.nearby || 0,
      tarefasNaAgenda: (d.tasks || []).length,
      // contas e rotinas: só quantidades (nunca valores nem nomes)
      rotinas: (d.routines || []).length,
      contasFixas: (d.fin?.fixas || []).length,
      anotacoesDeGasto: (d.fin?.mov || []).length,
      definiuLimiteDeGastos: !!d.fin?.limite,
      // só quantidades, nunca valores
      informouSaldo: !!d.fin?.saldo,
      gastosNoCredito: (d.fin?.mov ?? []).filter((x: any) => x?.forma === 'credito').length,
      faturasPagas: (d.fin?.faturas ?? []).length,
      contasSemanaisOuAnuais: (d.fin?.fixas ?? []).filter((x: any) => x?.freq === 'semanal' || x?.freq === 'anual').length,
      pesquisa3: d.survey?.d3 || null,
      pesquisa7: d.survey?.d7 || null,
    };
  });

const testadores = pessoas.filter((p) => !p.dono);
const base = testadores.length ? testadores : pessoas;
// Retenção: voltou no dia seguinte ao início? usou 3+ dias diferentes?
const voltouD1 = base.filter((p) => p.inicio && p.dias.some((x: string) => x > p.inicio)).length;
const tresDias = base.filter((p) => p.diasUsados >= 3).length;
const r7 = base.map((p) => p.pesquisa7).filter(Boolean) as any[];
const r3 = base.map((p) => p.pesquisa3).filter(Boolean) as any[];
const nps = r7.map((r) => Number(r.nps)).filter((n) => Number.isFinite(n));
const npsScore = nps.length ? pct(nps.filter((n) => n >= 9).length, nps.length) - pct(nps.filter((n) => n <= 6).length, nps.length) : null;
const contar = (rs: any[], k: string) => rs.reduce((acc: Record<string, number>, r) => { const v = r?.[k]; if (v != null && v !== '') acc[v] = (acc[v] || 0) + 1; return acc; }, {});

const resumo = {
  geradoEm: new Date().toISOString(),
  testadores: testadores.length,
  donoIncluido: pessoas.length - testadores.length,
  uso: {
    pedidosTotal: base.reduce((a, p) => a + p.pedidos, 0),
    planosConfirmados: base.reduce((a, p) => a + p.planosConfirmados, 0),
    tarefasConcluidas: base.reduce((a, p) => a + p.tarefasConcluidas, 0),
    avisosAbertos: base.reduce((a, p) => a + p.avisosAbertos, 0),
    comAvisosLigados: `${base.filter((p) => p.avisosLigados).length} de ${base.length}`,
    voltaramNoDiaSeguinte: `${voltouD1} de ${base.length}`,
    usaram3DiasOuMais: `${tresDias} de ${base.length}`,
    iaFalhas: base.reduce((a, p) => a + p.iaFalhas, 0),
    iaFalhasPorMotivo: base.reduce((acc: Record<string, number>, p) => { for (const [k, v] of Object.entries(p.iaFalhasPorMotivo as Record<string, number>)) acc[k] = (acc[k] || 0) + Number(v || 0); return acc; }, {}),
    tiposDePedido: base.reduce((acc: Record<string, number>, p) => { for (const [k, v] of Object.entries(p.tiposDePedido as Record<string, number>)) acc[k] = (acc[k] || 0) + Number(v || 0); return acc; }, {}),
    usaramContas: `${base.filter((p) => p.contasFixas + p.anotacoesDeGasto > 0).length} de ${base.length}`,
    salvaramComGoogle: `${base.filter((p) => p.contaGoogle).length} de ${base.length}`,
    usaramRotinas: `${base.filter((p) => p.rotinas > 0).length} de ${base.length}`,
  },
  pesquisaDia3: {
    respostas: r3.length,
    facilidadeMedia1a5: avg(r3.map((r) => Number(r.facil)).filter(Number.isFinite)),
    irisEntendeu: contar(r3, 'entendeu'),
    avisosAjudaram: contar(r3, 'avisos'),
    oQueIrritouOuFaltou: r3.map((r) => r.irritou).filter(Boolean),
  },
  pesquisaDia7: {
    respostas: r7.length,
    seanEllis_seNaoPudesseMaisUsar: contar(r7, 'ellis'),
    pmfMuitoDecepcionado: r7.length ? `${pct(r7.filter((r) => r.ellis === 'Muito decepcionado').length, r7.length)}% (meta: 40% ou mais)` : null,
    nps: npsScore,
    notasNps: nps,
    jeitoDaIris: contar(r7, 'iris'),
    pagariaPorMes: contar(r7, 'preco'),
    maisQueria: contar(r7, 'queria'),
    principalBeneficio: r7.map((r) => r.beneficio).filter(Boolean),
    comoMelhorar: r7.map((r) => r.melhorar).filter(Boolean),
  },
  chamadasIA14dias: (() => {
    const ok = aiLog.filter((r) => r.status === 200), ms = ok.map((r) => r.ms).sort((a, b) => a - b);
    const q = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
    return { total: aiLog.length, comErro: aiLog.length - ok.length, errosPorStatus: contar(aiLog.filter((r) => r.status !== 200), 'status'), cortadas: ok.filter((r) => r.stop === 'max_tokens').length, tempoMedianoMs: q(0.5), tempo90Ms: q(0.9), modelos: contar(aiLog, 'model') };
  })(),
  problemasRelatados: reports.map((r) => ({ quando: r.created_at.slice(0, 16), texto: r.text, aparelho: r.ctx?.aparelho, erro: r.ctx?.ultimoErro })),
  porPessoa: pessoas.map(({ dias, ...p }) => p),
};

// O GitHub mostra até 10 anotações por etapa e corta cada uma em ~4 KB: divide em partes de 3000 caracteres.
const txt = JSON.stringify(resumo);
const TAM = 3000;
const partes = Math.ceil(txt.length / TAM);
for (let i = 0; i < partes; i++) console.log(`::warning::RELATÓRIO ${i + 1}/${partes}: ${txt.slice(i * TAM, (i + 1) * TAM)}`);
console.log(JSON.stringify(resumo, null, 2));
