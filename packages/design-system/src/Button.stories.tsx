import type { Meta, StoryObj } from '@storybook/react-vite';
import { RefreshCw } from 'lucide-react';
import { Button } from './index.js';
const meta = { title: '공통/버튼', component: Button, args: { children: '다시 확인' } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
const icon = <RefreshCw className="size-icon-base shrink-0 stroke-emphasis" aria-hidden="true" focusable="false" />;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true, children: '확인중' } };
export const WithIcon: Story = { args: { children: <>{icon}새로 가져오기</> } };
export const IconOnly: Story = { args: { 'aria-label': '다시 확인', children: icon, className: 'w-control px-0' } };
export const Variants: Story = {
  render: () => <div className="grid gap-4 p-6">
    {(['md', 'sm'] as const).map(size => <div key={size} className="flex flex-wrap items-center gap-2">
      <Button size={size}>{icon}지원 페이지 열기</Button>
      <Button size={size} variant="secondary">원문 보기</Button>
      <Button size={size} variant="quiet">관심 없음</Button>
      <Button size={size} variant="danger">지원 건 삭제</Button>
      <Button size={size} disabled>저장중</Button>
    </div>)}
  </div>,
};
