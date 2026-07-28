import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Form,
  Input,
  message,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tooltip,
} from 'antd';
import { useForm } from 'antd/lib/form/Form';
import { v4 as uuid } from 'uuid';
import {
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { DndContext } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import PageHeader from '../PageHeader';
import './style.less';
import { reloadConfig } from '@/common';
import { StorageKeyEnum } from '@/common/const';
import { MatchTypeEnum, RuleItem } from '@/pages/Background/types';
import { useI18n } from '@/common/i18n';

const COLOR_KEYS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'] as const;

const COLOR_VALUES: Record<string, string> = {
  grey: '#8a94a4',
  blue: '#2167f3',
  red: '#ef5b5b',
  yellow: '#f7a51c',
  green: '#16b886',
  pink: '#e54f9f',
  purple: '#8c45ed',
  cyan: '#16b8ca',
};

interface RowContextProps {
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  listeners?: SyntheticListenerMap;
}

const RowContext = React.createContext<RowContextProps>({});

const canUseStorage = () => typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);

const createDemoRules = (): RuleItem[] => [
  {
    ruleId: 'demo-github',
    name: 'GitHub',
    groupTitle: 'GitHub',
    priority: 0,
    groupColor: 'blue',
    matchType: MatchTypeEnum.Domain,
    matchContent: 'github.com',
    sortIndex: 0,
  },
  {
    ruleId: 'demo-antd',
    name: 'Ant Design',
    groupTitle: 'Ant Design',
    priority: 0,
    groupColor: 'cyan',
    matchType: MatchTypeEnum.Domain,
    matchContent: 'ant-design.antgroup.com',
    sortIndex: 1,
  },
  {
    ruleId: 'demo-docs',
    name: '开发文档',
    groupTitle: '开发文档',
    priority: 0,
    groupColor: 'green',
    matchType: MatchTypeEnum.RegExp,
    matchContent: '(developer.chrome.com|developer.mozilla.org)',
    sortIndex: 2,
  },
  {
    ruleId: 'demo-files',
    name: '本地文件',
    groupTitle: '本地文件',
    priority: 0,
    groupColor: 'purple',
    matchType: MatchTypeEnum.Domain,
    matchContent: 'file://',
    sortIndex: 3,
  },
];

const DragHandle: React.FC = () => {
  const { setActivatorNodeRef, listeners } = useContext(RowContext);
  return (
    <Button
      type="text"
      className="rule-drag-handle"
      icon={<HolderOutlined />}
      ref={setActivatorNodeRef}
      {...listeners}
      aria-label="Drag"
    />
  );
};

const SortableRuleRow: React.FC<{
  rule: RuleItem;
  onEdit: (rule: RuleItem) => void;
  onDelete: (sortIndex: number) => void;
}> = ({ rule, onEdit, onDelete }) => {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.ruleId });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 10 } : {}),
    '--rule-color': COLOR_VALUES[rule.groupColor || 'grey'],
  } as React.CSSProperties;

  const contextValue = useMemo(
    () => ({ setActivatorNodeRef, listeners }),
    [setActivatorNodeRef, listeners],
  );

  return (
    <RowContext.Provider value={contextValue}>
      <div
        ref={setNodeRef}
        style={style}
        className={`rule-row${isDragging ? ' is-dragging' : ''}`}
        {...attributes}
      >
        <DragHandle />
        <strong className="rule-name" title={rule.name}>{rule.name}</strong>
        <span className={`rule-mode rule-mode-${rule.matchType === MatchTypeEnum.RegExp ? 'regexp' : 'domain'}`}>
          {rule.matchType === MatchTypeEnum.RegExp ? t('regExp') : t('domain')}
        </span>
        <code className="rule-match" title={rule.matchContent}>{rule.matchContent}</code>
        <Tooltip title={t(rule.groupColor || 'grey')}>
          <span className="rule-color-dot" aria-label={t(rule.groupColor || 'grey')} />
        </Tooltip>
        <Space className="rule-actions" size={2}>
          <Button
            type="text"
            icon={<EditOutlined />}
            aria-label={t('edit')}
            onClick={() => onEdit(rule)}
          />
          <Popconfirm
            placement="left"
            title={t('deleteRuleConfirm')}
            onConfirm={() => onDelete(rule.sortIndex)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} aria-label={t('delete')} />
          </Popconfirm>
        </Space>
      </div>
    </RowContext.Provider>
  );
};

const Rules: React.FC = () => {
  const { t } = useI18n();
  const [dataSource, setDataSource] = useState<RuleItem[]>([]);
  const [editData, setEditData] = useState<Partial<RuleItem>>();
  const [form] = useForm<RuleItem>();

  const colorOptions = useMemo(
    () => COLOR_KEYS.map(value => ({
      value,
      label: (
        <span className="rule-color-option">
          <span style={{ background: COLOR_VALUES[value] }} />
          {t(value)}
        </span>
      ),
    })),
    [t],
  );

  const notifyRuleUpdate = useCallback(() => {
    if (typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)) {
      reloadConfig(t('ruleUpdateSuccess'));
    } else {
      message.success(t('ruleUpdateSuccess'));
    }
  }, [t]);

  const reloadRules = useCallback(async () => {
    if (!canUseStorage()) {
      setDataSource(createDemoRules());
      return;
    }

    const response = await chrome.storage.sync.get(StorageKeyEnum.RULES);
    const rules: RuleItem[] = response[StorageKeyEnum.RULES] || [];
    const normalizedRules = rules.map((item, index) => ({
      ...item,
      ruleId: item.ruleId || uuid(),
      priority: item.priority ?? 0,
      sortIndex: index,
    }));

    setDataSource(normalizedRules);
    if (rules.some(item => !item.ruleId || item.priority === undefined)) {
      await chrome.storage.sync.set({ [StorageKeyEnum.RULES]: normalizedRules });
    }
  }, []);

  const persistRules = useCallback(async (rules: RuleItem[]) => {
    setDataSource(rules);
    if (canUseStorage()) await chrome.storage.sync.set({ [StorageKeyEnum.RULES]: rules });
    notifyRuleUpdate();
  }, [notifyRuleUpdate]);

  const handleDelete = useCallback((sortIndex: number) => {
    const nextRules = dataSource
      .filter(item => item.sortIndex !== sortIndex)
      .map((item, index) => ({ ...item, sortIndex: index }));
    persistRules(nextRules);
  }, [dataSource, persistRules]);

  const openEditor = useCallback((rule?: RuleItem) => {
    const nextValue: Partial<RuleItem> = rule || {
      matchType: MatchTypeEnum.Domain,
      groupColor: 'blue',
    };
    setEditData(nextValue);
    form.setFieldsValue(nextValue);
  }, [form]);

  const closeEditor = useCallback(() => {
    setEditData(undefined);
    form.resetFields();
  }, [form]);

  const getCurrentTabUrl = useCallback(async () => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      form.setFieldsValue({ matchContent: 'example.com' });
      return;
    }

    const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTabs.length || !currentTabs[0].url) return;
    const url = new URL(currentTabs[0].url);
    form.setFieldsValue({
      matchContent: `${form.getFieldValue('matchContent') || ''}${url.host}`,
    });
  }, [form]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const activeIndex = dataSource.findIndex(record => record.ruleId === active.id);
    const overIndex = dataSource.findIndex(record => record.ruleId === over.id);
    const nextRules = arrayMove(dataSource, activeIndex, overIndex)
      .map((item, index) => ({ ...item, sortIndex: index }));
    persistRules(nextRules);
  };

  const onFormOk = async () => {
    await form.validateFields();
    const formData = form.getFieldsValue();
    const nextRules = [...dataSource];
    const nextRule: RuleItem = {
      ...formData,
      sortIndex: editData?.sortIndex ?? Math.max(-1, ...dataSource.map(item => item.sortIndex)) + 1,
      ruleId: editData?.ruleId || uuid(),
      priority: editData?.priority ?? 0,
      groupTitle: formData.name,
    };

    if (editData?.ruleId) {
      const index = nextRules.findIndex(item => item.ruleId === editData.ruleId);
      nextRules[index] = nextRule;
    } else {
      nextRules.push(nextRule);
    }

    await persistRules(nextRules);
    closeEditor();
  };

  useEffect(() => {
    reloadRules();
  }, [reloadRules]);

  const actions = (
    <>
      <Button icon={<ReloadOutlined />} onClick={() => {
        reloadRules();
        notifyRuleUpdate();
      }}>
        {t('refreshRules')}
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
        {t('newRule')}
      </Button>
    </>
  );

  return (
    <section className="popup-screen rules-screen">
      <PageHeader title={t('tabRules')} subtitle={t('rulesDescription')} actions={actions} />

      <div className="rules-list">
        <div className="rules-list-header">
          <span />
          <span>{t('groupTitle')}</span>
          <span>{t('matchMode')}</span>
          <span>{t('matchContent')}</span>
          <span>{t('groupColor')}</span>
          <span>{t('actions')}</span>
        </div>

        <DndContext onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis]}>
          <SortableContext
            items={dataSource.map(item => item.ruleId)}
            strategy={verticalListSortingStrategy}
          >
            <div className="rules-list-body screen-scroll">
              {dataSource.map(rule => (
                <SortableRuleRow
                  key={rule.ruleId}
                  rule={rule}
                  onEdit={openEditor}
                  onDelete={handleDelete}
                />
              ))}
              {!dataSource.length && <div className="rules-empty">{t('noRules')}</div>}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="rules-hint">
        <InfoCircleOutlined />
        <span>{t('rulePriorityHint')}</span>
      </div>

      <Drawer
        rootClassName="rule-editor-drawer"
        width={294}
        open={Boolean(editData)}
        onClose={closeEditor}
        title={(
          <div className="drawer-heading">
            <strong>{editData?.ruleId ? t('editRule') : t('newRule')}</strong>
            <span>{t('ruleEditorDescription')}</span>
          </div>
        )}
        footer={(
          <div className="drawer-footer-actions">
            <Button onClick={closeEditor}>{t('cancel')}</Button>
            <Button type="primary" onClick={onFormOk}>{t('saveRule')}</Button>
          </div>
        )}
      >
        <Form form={form} layout="vertical" className="rule-editor-form">
          <Form.Item
            label={t('groupTitle')}
            name="name"
            rules={[{ required: true, message: t('ruleNameRequired') }]}
          >
            <Input placeholder={t('groupTitlePlaceholder')} allowClear />
          </Form.Item>

          <Form.Item
            label={t('groupColor')}
            name="groupColor"
            rules={[{ required: true, message: t('groupColorRequired') }]}
          >
            <Select options={colorOptions} placeholder={t('groupColorPlaceholder')} />
          </Form.Item>

          <Form.Item
            label={t('matchMode')}
            name="matchType"
            rules={[{ required: true, message: t('matchModeRequired') }]}
          >
            <Radio.Group className="rule-match-mode" optionType="button" buttonStyle="outline">
              <Radio.Button value={MatchTypeEnum.Domain}>{t('matchByDomain')}</Radio.Button>
              <Radio.Button value={MatchTypeEnum.RegExp}>{t('regExp')}</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            className="rule-content-item"
            label={(
              <span className="rule-content-label">
                <span>{t('matchContent')}</span>
                <Button type="link" icon={<LinkOutlined />} onClick={getCurrentTabUrl}>
                  {t('insertCurrentDomain')}
                </Button>
              </span>
            )}
            name="matchContent"
            rules={[{ required: true, message: t('matchContentRequired') }]}
            extra={t('regExpMatchTip')}
          >
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 5 }}
              placeholder={t('inputPlaceholder')}
              allowClear
            />
          </Form.Item>
        </Form>
      </Drawer>
    </section>
  );
};

export default Rules;
