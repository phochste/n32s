import * as N3 from 'n3';
import * as fs from 'fs';
import { getLogger } from "log4js";

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

const logger = getLogger();

export type IPSO = {
    type: 'PSO',
    subject: ITerm ,
    predicate: ITerm ,
    object: ITerm ,
};

export type ITerm = INamedNode | IBlankNode | ILiteral | IVariable | IGraph | IList;

export type INamedNode = {
    type: 'NamedNode';
    value: string;
    datatype: null;
};

export type IBlankNode = {
    type: 'BlankNode';
    value: string;
    datatype: null;
};

export type ILiteral = {
    type: 'Literal';
    value: string;
    datatype: string;
};

export type IVariable = {
    type: 'Variable';
    value: string;
    datatype: null;
};

export type IList = {
    type: 'List';
    value: ITerm[]
    datatype: null;
};

export type IGraph = {
    type: 'Graph';
    value: IPSO[];
    datatype: null;
};

export async function parseN3File(file: string) : Promise<N3.Store> {
    logger.debug(`parsing: ${file}`);
    const n3 = fs.readFileSync(file, { encoding: "utf8"});
    return parseN3(n3);
}

export async function parseN3(n3: string) : Promise<N3.Store> {
    return new Promise<N3.Store>( (resolve,reject) => {
        const parser = new N3.Parser({ format: 'text/n3' });
        const store  = new N3.Store(); 

        parser.parse(n3,
            (error, quad, _prefixes) => {
                if (error) {
                    reject(error.message);
                }

                if (quad) {
                    store.add(quad)
                }
                else {
                    resolve(store);
                }
            }
        );
    });
}

export function serializeN3Store(store: N3.Store) : void {
    store.forEach( (quad) => {
        const subject   = quad.subject.value;
        const predicate = quad.predicate.value;
        const object    = quad.object.value;
        const graph     = quad.graph.value;

        console.log(`${subject} || ${predicate} || ${object} IN ${graph}`);
    }, null, null, null, null);
}

function pref(type: string, value: string) : string {
    return type + value;
}

export function writeDynamic(graph: IGraph, except: string[] = []) : string {
    const dynamicTerms = new Set<string>();

    graph.value.forEach( (pso) => {
        scanDynamicTerm(pso,dynamicTerms);
    });

    return  Array.from(dynamicTerms)
                 .filter( (dyn) => {
                    let result = true ;
                    except.forEach( (ex) => {
                        if (dyn.match(ex)) {
                            result = false;
                        }
                    });
                    return result;
                 })
                 .map( (dyn) => {
                        return `:- dynamic('<${dyn}>'/2).`;
                 }).join("\n");
}

function scanDynamicTerm(pso: IPSO, container: Set<string>) : void {
    if (pso.predicate.type === 'NamedNode') {
        container.add(pso.predicate.value);
    }

    if (pso.subject.type === 'Graph') {
        pso.subject.value.forEach( (pso_i) => {
            scanDynamicTerm(pso_i, container);
        });    
    }
    if (pso.predicate.type === 'Graph') {
        pso.predicate.value.forEach( (pso_i) => {
            scanDynamicTerm(pso_i, container);
        });    
    }
    if (pso.object.type === 'Graph') {
        pso.object.value.forEach( (pso_i) => {
            scanDynamicTerm(pso_i, container);
        });    
    }
}

export function writeGraph(graph: IGraph) : string {
    const result : string[] = [];

    graph.value.forEach( (pso) => {
        const value = writePSO(pso);
        result.push(value);
    });

    return result.join("\n");
};

function writePSO(pso: IPSO) : string {
    const subject   = writeTerm(pso.subject);
    const predicate = writeTerm(pso.predicate);
    const object    = writeTerm(pso.object);

    return `${predicate}(${subject},${object}).`;
}

function writeTerm(term: ITerm) : string {
    if (term.type === 'NamedNode') {
        return `'<${term.value}>'`;
    }
    else if (term.type === 'Literal') {
        if (term.datatype === pref(XSD,'string')) {
            return `'${term.value}'`;
        }
        else if (term.datatype === pref(XSD,'integer')) {
            return term.value;
        }
        else if (term.datatype === pref(XSD,'boolean')) {
            return term.value;
        }
        else {
            return `literal('${term.value}','${term.datatype}')`;
        }
    }
    else if (term.type === 'BlankNode') {
        return `'${term.value}'`;
    }
    else if (term.type === 'Variable') {
        return `${term.value}`;
    }
    else if (term.type === 'List') {
        const result : string[] = [];
        term.value.forEach( (li) => {
            result.push(writeTerm(li));
        });
        return '[' + result.join(",") + ']';
    }
    else if (term.type === 'Graph') {
        const result : string[] = [];
        term.value.forEach( (gi) => {
            const value = writePSO(gi);
            result.push(value.replace(/\.$/,''));
        });

        return '(' + result.join(",") + ')';
    }

    return 'x';
}

export function makeGraph(store: N3.Store, graph: N3.Term = N3.DataFactory.defaultGraph()) : IGraph {
    const result : IGraph = {
        type: 'Graph',
        value: [] as IPSO[],
        datatype: null
    };

    // First process the named nodes and literals...
    store.forEach((quad) => {
        const termType = '' + quad.subject.termType;

        if (termType === 'Variable') {
            console.error(quad);
            throw new Error(`Variables are not supported in N3S!`);
        }

        if ((termType === 'NamedNode' || termType === 'Literal')
                && !isGraphLike(quad,graph)) {
            let subject   = parseTerm(quad.subject, store);
            let predicate = parseTerm(quad.predicate, store);
            let object    = parseTerm(quad.object, store);
            result.value.push({
                type: 'PSO',
                subject: subject,
                predicate: predicate,
                object: object
            } as IPSO);
        }
    }, null, null, null, graph);

    // Next process the explicit bnodes...
    store.forEach((quad) => {
        const termType = '' + quad.subject.termType;
        if (termType === 'BlankNode' 
                && !isListLike(quad) 
                && !isGraphLike(quad,graph)) {
            let subject   = parseTerm(quad.subject, store);
            let predicate = parseTerm(quad.predicate, store);
            let object    = parseTerm(quad.object, store);
            result.value.push({
                type: 'PSO', 
                subject: subject,
                predicate: predicate,
                object: object
            } as IPSO);
        }
    }, null, null, null, graph);

    // Next process all the rest ...
    store.forEach((quad) => {
        const termType = '' + quad.subject.termType;
        if (termType === 'BlankNode' 
                && isListLike(quad) 
                && !isGraphLike(quad,graph)) {
            let subject   = parseTerm(quad.subject, store);
            let predicate = parseTerm(quad.predicate, store);
            let object    = parseTerm(quad.object, store);
            result.value.push({
                type: 'PSO', 
                subject: subject,
                predicate: predicate,
                object: object
            } as IPSO);
        }
    }, null, null, null, graph);

    return result;
}

function parseTerm(term: N3.Term, store: N3.Store) : ITerm {
    if (term.termType === 'NamedNode') {
        if (term.value === pref(RDF,'nil')) {
            return { type: 'List' , value: [] as ITerm[] } as IList;
        }
        else {
            return { type: 'NamedNode' , value: term.value} as INamedNode;
        }
    }
    else if (term.termType === 'Literal') {
        return {
            type: 'Literal',
            value: term.value ,
            datatype: term.datatypeString
        } as ILiteral;
    }
    else if (term.termType === 'BlankNode') {
        if (isList(term,store)) {
            return makeList(term,store);
        }
        else if (isGraph(term,store)) {
            return makeGraph(store,term);
        }
        else {
            const genid = makeGenId(term);
            return {
                type: 'BlankNode',
                value: genid
            } as IBlankNode;   
        }
    }
    else if (term.termType === 'Variable') {
        return {
            type: 'Variable',
            value: term.value
        } as IVariable;
    }
    else {
        return {
            type: 'BlankNode',
            value: 'unknown'
        } as IBlankNode;
    }
}

function makeGenId(term: N3.Term) : string {
    const value = term.value.replace(/^.*(_|\.)/,'') ;
    return `_:${value}`;   
}

function isGraphLike(quad: N3.Quad, graph: N3.Term) : boolean {
    if (quad.graph.id === graph.id) {
        return false;
    }
    else {
        return true;
    }
}

function isListLike(quad: N3.Quad) : boolean {
    if (quad.predicate.value === pref(RDF,'first') ||
        quad.predicate.value === pref(RDF,'rest')) {
        return true;
    }
    else {
        return false;
    }
} 

function isList(term: N3.Term, store: N3.Store) : boolean {
    let searchTerm = term;
    let brake = false;
    do {
        const first = store.getQuads(searchTerm,pref(RDF,'first'),null,null);
        const rest = store.getQuads(searchTerm,pref(RDF,'rest'),null,null);

        if (first.length == 1 && rest.length == 1) {
            // we are ok
        }
        else {
            return false;
        }

        if (rest[0].object.value === pref(RDF,'nil')) {
            brake = true;
        }
        else {
            searchTerm = rest[0].object;
        }
    } while (!brake);

    return true;
}

function isGraph(term: N3.Term, store: N3.Store) : boolean {
    const graph = store.getQuads(null, null, null, term);

    if (graph.length == 0) {
        return false;
    }
    else {
        return true;
    }
}

function makeList(term: N3.Term, store: N3.Store) : IList {
    let termList : ITerm[] = [];
    let searchTerm = term;
    let brake = false;

    do {
        const first = store.getQuads(searchTerm,pref(RDF,'first'),null,null);
        const rest  = store.getQuads(searchTerm,pref(RDF,'rest'),null,null);

        if (first.length == 0) {
            if (rest.length == 0 || rest.length != 1) {
                brake = true;
            }
            else {
                brake = true;
            }
        }
        else if (first.length != 1 || rest.length != 1) {
            brake = true;
        } 
        else if (first[0].object.value === pref(RDF,'nil')) {
            const termValue = { type: 'List', value: [] as ITerm[]} as IList;

            termList.push(termValue);

            if (rest[0].object.value === pref(RDF,'nil')) {
                brake = true;
            }
            else {
                searchTerm = rest[0].object;
            }
        }
        else {
            const termValue = parseTerm(first[0].object, store);

            termList.push(termValue);

            if (rest[0].object.value === pref(RDF,'nil')) {
                brake = true;
            }
            else {
                searchTerm = rest[0].object;
            }
        }

        first.forEach( (quad) => { store.removeQuad(quad) });
        rest.forEach( (quad) => { store.removeQuad(quad) });
    } while (!brake);
    
    return { type: 'List', value: termList } as IList;
}