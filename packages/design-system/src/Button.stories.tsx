import type { Meta, StoryObj } from '@storybook/react-vite';
import { RefreshCw } from 'lucide-react';
import { Button } from './index.js';
const meta = { title: '공통/버튼', component: Button, args: { children: '다시 확인' } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true, children: '확인중' } };

export const WithIcon: Story = { args: { children: <><RefreshCw className="size-icon-md shrink-0 stroke-icon" aria-hidden="true" focusable="false" />다시 확인</> } };
export const IconOnly: Story = { args: { 'aria-label': '다시 확인', children: <RefreshCw className="size-icon-md shrink-0 stroke-icon" aria-hidden="true" focusable="false" /> } };
