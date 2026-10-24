import type { Blocks } from '@/lib/documents';

// Starting points for new documents. Partial BlockNote blocks: the editor fills
// in ids and default props. Dates are filled in when the document is created.

export interface DocTemplate {
  id: string;
  name: string;
  description: string;
  title: (date: string) => string;
  content: (date: string) => Blocks;
}

const h = (text: string, level = 2) => ({ type: 'heading', props: { level }, content: text });
const p = (text = '') => ({ type: 'paragraph', content: text });
const bullet = (text = '') => ({ type: 'bulletListItem', content: text });
const todo = (text = '') => ({ type: 'checkListItem', props: { checked: false }, content: text });

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: 'blank',
    name: 'Blank document',
    description: 'Start from an empty page',
    title: () => 'Untitled',
    content: () => [],
  },
  {
    id: 'meeting',
    name: 'Møtereferat',
    description: 'Agenda, beslutninger og oppgaver',
    title: (date) => `Møtereferat ${date}`,
    content: (date) => [
      p(`Dato: ${date}`),
      p('Til stede: '),
      h('Agenda'),
      bullet(),
      h('Notater'),
      p(),
      h('Beslutninger'),
      bullet(),
      h('Oppgaver'),
      todo('Oppgave – ansvarlig – frist'),
    ],
  },
  {
    id: 'brief',
    name: 'Prosjektbrief',
    description: 'Mål, omfang, leveranser og tidsplan',
    title: () => 'Prosjektbrief: ',
    content: () => [
      h('Bakgrunn'),
      p('Hvorfor gjør vi dette nå?'),
      h('Mål'),
      bullet('Hva skal være annerledes når prosjektet er ferdig?'),
      h('Omfang'),
      p('Med: '),
      p('Ikke med: '),
      h('Leveranser'),
      todo(),
      h('Tidsplan'),
      bullet('Oppstart: '),
      bullet('Ferdig: '),
      h('Team og roller'),
      bullet('Prosjektleder: '),
      h('Risiko'),
      bullet(),
    ],
  },
  {
    id: 'weekly',
    name: 'Ukesrapport',
    description: 'Fremdrift, neste uke og hindringer',
    title: (date) => `Ukesrapport ${date}`,
    content: () => [
      h('Gjort denne uken'),
      bullet(),
      h('Plan for neste uke'),
      bullet(),
      h('Hindringer og behov'),
      bullet(),
      h('Tall og nøkkelpunkter'),
      p(),
    ],
  },
];
