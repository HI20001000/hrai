export const sampleProjects = [
  {
    id: 'proj-1',
    name: '品牌升級專案',
    ownerId: 'u-001',
    status: null,
    updatedAt: '2025-02-01 10:30',
    createdAt: '2025-01-15 09:00',
    products: [
      {
        id: 'prod-1',
        name: '品牌視覺套件',
        ownerId: 'u-002',
        updatedAt: '2025-02-02 14:10',
        createdAt: '2025-01-16 11:30',
        tasks: [
          {
            id: 'task-1',
            name: 'Logo 重製',
            ownerId: 'u-010',
            updatedAt: '2025-02-03 18:00',
            createdAt: '2025-01-17 09:15',
            steps: [
              {
                id: 'step-1',
                status: '待處理',
                ownerId: 'u-010',
                content: '蒐集品牌關鍵字與競品參考',
                updatedAt: '2025-01-18 09:30',
                createdAt: '2025-01-18 09:00',
              },
              {
                id: 'step-2',
                status: '進行中',
                ownerId: 'u-011',
                content: '提出 3 組草案並安排評審',
                updatedAt: '2025-02-02 16:20',
                createdAt: '2025-01-20 14:00',
              },
            ],
          },
          {
            id: 'task-2',
            name: '品牌手冊',
            ownerId: 'u-012',
            updatedAt: '2025-02-04 11:45',
            createdAt: '2025-01-19 10:40',
            steps: [
              {
                id: 'step-3',
                status: '待處理',
                ownerId: 'u-012',
                content: '彙整色票與字體規範',
                updatedAt: '2025-02-01 10:05',
                createdAt: '2025-01-19 11:00',
              },
            ],
          },
        ],
      },
      {
        id: 'prod-2',
        name: '行銷素材',
        ownerId: 'u-004',
        updatedAt: '2025-02-01 15:20',
        createdAt: '2025-01-22 13:10',
        tasks: [
          {
            id: 'task-3',
            name: '社群貼文排程',
            ownerId: 'u-020',
            updatedAt: '2025-02-05 09:20',
            createdAt: '2025-01-23 09:00',
            steps: [
              {
                id: 'step-4',
                status: '完成',
                ownerId: 'u-020',
                content: '完成 2 月排程與排版',
                updatedAt: '2025-02-05 09:10',
                createdAt: '2025-01-25 13:00',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'proj-2',
    name: '智慧平台導入',
    ownerId: 'u-003',
    status: null,
    updatedAt: '2025-02-03 09:45',
    createdAt: '2025-01-10 08:30',
    products: [
      {
        id: 'prod-3',
        name: '客戶導入',
        ownerId: 'u-006',
        updatedAt: '2025-02-04 16:05',
        createdAt: '2025-01-12 14:15',
        tasks: [
          {
            id: 'task-4',
            name: '需求確認',
            ownerId: 'u-030',
            updatedAt: '2025-02-04 17:10',
            createdAt: '2025-01-13 10:10',
            steps: [
              {
                id: 'step-5',
                status: '進行中',
                ownerId: 'u-030',
                content: '整理訪談結果並確認需求清單',
                updatedAt: '2025-02-04 17:00',
                createdAt: '2025-02-01 11:00',
              },
            ],
          },
        ],
      },
    ],
  },
]
