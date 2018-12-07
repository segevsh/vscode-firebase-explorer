import * as path from 'path';
import * as vscode from 'vscode';
import { AccountInfo } from '../accounts/interfaces';
import { FirebaseProject } from '../projects/ProjectManager';
import {
  FirestoreAPI,
  DocumentFieldValue,
  processFieldValue,
  getFieldArrayValue
} from './api';

export class FirestoreProvider
  implements vscode.TreeDataProvider<FirestoreProviderItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    FirestoreProviderItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FirestoreProviderItem): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: FirestoreProviderItem
  ): Promise<FirestoreProviderItem[]> {
    const account = this.context.globalState.get<AccountInfo>(
      'selectedAccount'
    );
    const project = this.context.globalState.get<FirebaseProject>(
      'selectedProject'
    );

    if (!account || !project) {
      // No selected account or project
      return [];
    }

    const api = FirestoreAPI.for(account, project);

    if (!element) {
      const collections = await api.listCollections('');

      if (!Array.isArray(collections.collectionIds)) {
        return [];
      }

      return collections.collectionIds.map(
        id => new CollectionItem(id, '', account, project)
      );
    } else if (element instanceof CollectionItem) {
      const colPath = getFullPath(element.parentPath, element.name);
      const documents = await api.listDocuments(colPath);

      if (!Array.isArray(documents.documents)) {
        element.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this._onDidChangeTreeData.fire(element);
        return [];
      }

      return documents.documents.map(
        doc => new DocumentItem(doc.name, colPath, account, project)
      );
    } else if (element instanceof DocumentItem) {
      const docPath = getFullPath(element.parentPath, element.name);
      let items: FirestoreProviderItem[] = [];

      const [collections, document] = await Promise.all([
        api.listCollections(docPath),
        api.getDocument(docPath)
      ]);

      const hasCollections = Array.isArray(collections.collectionIds);
      const hasFields = !!document.fields;

      if (hasCollections) {
        items.push(
          ...collections.collectionIds.map(
            id => new CollectionItem(id, docPath, account, project)
          )
        );
      }

      if (hasFields) {
        const docFields = Object.keys(document.fields!).sort();
        items.push(
          ...docFields.map(
            name => new DocumentFieldItem(name, document.fields![name])
          )
        );
      }

      if (!hasCollections && !hasFields) {
        element.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this._onDidChangeTreeData.fire(element);
      }

      return items;
    } else if (element instanceof DocumentFieldItem) {
      // TODO: children of "map" field type
      return Object.keys(element.value.fields).sort().map(
        key => new DocumentFieldItem(key, element.value.fields[key], true)
      );
    } else {
      // error?
      console.error('Should not happen!', element);
      return [];
    }
  }
}

export class CollectionItem extends vscode.TreeItem {
  contextValue = 'firestore.collection';
  iconPath = path.join(
    __filename,
    '..',
    '..',
    '..',
    'assets',
    'forestore-collection.svg'
  );

  constructor(
    public name: string,
    public parentPath: string,
    public account: AccountInfo,
    public project: FirebaseProject,
    public readonly command?: vscode.Command
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
  }

  get tooltip(): string {
    return getFullPath(this.parentPath, this.name);
  }
}

export class DocumentItem extends vscode.TreeItem {
  contextValue = 'firestore.document';
  iconPath = path.join(
    __filename,
    '..',
    '..',
    '..',
    'assets',
    'forestore-document.svg'
  );

  // readonly command: vscode.Command;

  name: string;

  constructor(
    public fullName: string,
    public parentPath: string,
    public account: AccountInfo,
    public project: FirebaseProject
  ) {
    super('', vscode.TreeItemCollapsibleState.Collapsed);
    this.name = this.fullName.split('/').slice(-1)[0];
    this.label = this.name;
    // this.command = {
    //   command: 'firebaseExplorer.documentSelection',
    //   title: '',
    //   arguments: [
    //     this.account,
    //     this.project,
    //     getFullPath(this.parentPath, this.name)
    //   ]
    // };
  }

  get tooltip(): string {
    return this.fullName;
  }
}

export class DocumentFieldItem extends vscode.TreeItem {
  contextValue = 'firestore.documentField';
  iconPath: string;
  type: string;
  value: any;

  constructor(
    public name: string,
    public fieldValue: DocumentFieldValue,
    expand = false
  ) {
    super('');

    const { type, value } = processFieldValue(fieldValue);
    this.type = type;
    this.value = value;

    const typeIcon = type === 'integer' || type === 'double' ? 'number' : type;
    this.iconPath = path.join(
      __filename,
      '..',
      '..',
      '..',
      'assets',
      `valuetype-${typeIcon}.svg`
    );

    if (type === 'map') {
      this.collapsibleState = expand
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    let labelValue: any;

    if (type === 'array') {
      labelValue = getFieldArrayValue(value.values);
    } else if (type === 'map') {
      // TODO
      labelValue = void 0;
    } else {
      labelValue = value;
    }

    if (labelValue === void 0) {
      this.label = name;
    } else {
      let escapedValue = labelValue;
      if (type === 'string' || type === 'array') {
        escapedValue = JSON.stringify(escapedValue);
      }
      if (typeof escapedValue === 'string') {
        escapedValue = escapedValue.replace('<', '&lt;').replace('>', '&gt;');
      }
      this.label = `${name}: <code>${escapedValue}</code>`;
    }
  }

  get tooltip(): string {
    return this.type;
  }
}

function getFullPath(parentPath: string, name: string) {
  return [parentPath, name].filter(Boolean).join('/');
}

export type FirestoreProviderItem =
  | CollectionItem
  | DocumentItem
  | DocumentFieldItem;
