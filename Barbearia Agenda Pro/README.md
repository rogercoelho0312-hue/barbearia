# Plataforma de Agendamento e Gestão para Barbearias e Salões Locais

Este projeto é um MVP prático para vender como solução SaaS para barbearias, salões de beleza e estabelecimentos locais. Ele combina a experiência do cliente, a gestão do estabelecimento e lembretes automáticos em uma interface simples, funcional e fácil de adaptar.

## Visão geral

- Página de agendamento para clientes
- Painel administrativo para o dono do negócio
- Cadastro de serviços e profissionais
- Visualização de agenda por dia
- Bloqueio de horários
- Cálculo de faturamento diário
- Sistema de lembretes por WhatsApp/e-mail (simulado em API)

## Tecnologias

- Node.js
- Express
- SQLite
- HTML / CSS / JavaScript puro

## Como rodar

1. Instale as dependências:

   npm install

2. Inicie o projeto:

   npm start

3. Acesse:

   http://localhost:3000/

4. Painel do estabelecimento:

   http://localhost:3000/admin.html

## Modelo de negócio

### 1) SaaS mensal

- R$ 50 a R$ 100/mês por estabelecimento
- Inclusão de suporte, atualização e hospedagem
- Ideal para barbearias pequenas e médias

### 2) Venda única + suporte

- Venda do sistema pronto e personalizado com a marca do negócio
- Valor fechado para instalação e configurações iniciais
- Suporte técnico mensal opcional

## Funcionalidades principais

### Cliente

- Escolhe serviço
- Escolhe profissional
- Seleciona data e horário disponível
- Confirma agendamento pelo WhatsApp/telefone

### Estabelecimento

- Visualiza agenda do dia
- Bloqueia horários vazios ou indisponíveis
- Cadastra serviços e preços
- Consulta faturamento diário

### Lembretes

- Integrações com WhatsApp ou e-mail
- Envio de confirmação e lembrete 2 horas antes do atendimento
- Fluxo preparado para expansão com APIs reais

## Ideia de monetização

- Plano Starter: R$ 59/mês
- Plano Pro: R$ 99/mês
- Implementação única: R$ 1.500 a R$ 3.000
- Suporte técnico: R$ 50 a R$ 150/mês

## Próximos passos para escala

- Painel com login por usuário e permissões
- Integração real com WhatsApp Business API
- Dashboard com gráfico de faturamento mensal
- Relatórios por profissional e por serviço
- Sistema de cancelamento e reembolso
- Deploy em VPS ou nuvem

## Arquitetura sugerida para venda

- Frontend web responsivo
- Backend em Node.js
- Banco SQLite para MVP
- Hospedagem em VPS / Railway / Render / Vercel + servidor Node

## Observação

Este é um MVP funcional para demonstração e venda inicial. Pode ser expandido para uma plataforma completa, com autenticação, base de dados em produção, integrações e painel de administração robusto.
