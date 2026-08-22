import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhaseOneToolPage } from "./phase-one-tool-page";

const document = { id: "11111111-1111-1111-1111-111111111111", originalName: "report.pdf", mediaType: "application/pdf", byteSize: 604, pageCount: 2, checksumSha256: "a".repeat(64), createdAt: "2026-08-16T00:00:00Z", updatedAt: "2026-08-16T00:00:00Z" };
function capabilityPayload(overrides: Record<string, boolean> = {}) { return { storage:{available:true},database:{available:true},tools:{qpdf:{available:true,version:"12.4"},ocrmypdf:{available:false,reason:"missing"},pdfinfo:{available:true,version:"25"},pdftoppm:{available:true,version:"25"}},features:{upload:true,view:true,pageOperations:true,compression:true,searchableOcr:false,nativeEditing:false,organize:true,protect:true,unlock:true,watermark:true,pageNumbers:true,headerFooter:true,metadata:true,rename:true,thumbnails:true,...overrides},limits:{maxUploadBytes:1024},viewer:true,nativeContentEditing:false,overlayEditing:false,merge:true,split:true,compressLossless:true,compressAdvanced:false,ocrSearchable:false,ocrEditableReconstruction:false,convertPdfToImage:false,convertImageToPdf:true}; }
function wrapper(ui: React.ReactNode) { const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}); return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>); }

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("Phase 1 tool workflows",()=>{
  it("explains a missing overlay dependency and disables processing",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockImplementation((path:string)=>Promise.resolve({ok:true,status:200,json:async()=>path==="/api/capabilities"?{...capabilityPayload({watermark:false}),tools:{...capabilityPayload().tools,pdfinfo:{available:false,reason:"pdfinfo is not installed"}}}:{documents:[document]}})));
    wrapper(<PhaseOneToolPage kind="watermark"/>);
    expect(await screen.findByText("Capability unavailable")).toBeVisible();
    expect(screen.getByText("pdfinfo is not installed")).toBeVisible();
    expect(screen.getByRole("button",{name:"Apply watermark"})).toBeDisabled();
  });

  it("associates protect password validation and prevents duplicate submission",async()=>{
    const fetchMock=vi.fn().mockImplementation((path:string,init?:RequestInit)=>{if(path==="/api/capabilities")return Promise.resolve({ok:true,status:200,json:async()=>capabilityPayload()});if(path==="/api/documents")return Promise.resolve({ok:true,status:200,json:async()=>({documents:[document]})});if(init?.method==="POST")return Promise.resolve({ok:true,status:201,json:async()=>({document,version:{id:"v1",documentId:document.id,parentVersionId:null,operation:"protect",byteSize:700,checksumSha256:"b".repeat(64),metadata:{},createdAt:"2026-08-16T00:00:00Z"}})});return Promise.reject(new Error(`unexpected ${path}`));});
    vi.stubGlobal("fetch",fetchMock);wrapper(<PhaseOneToolPage kind="protect"/>);
    fireEvent.change(await screen.findByLabelText("Document"),{target:{value:document.id}});
    fireEvent.change(screen.getByLabelText("Open password"),{target:{value:"secret"}});
    fireEvent.change(screen.getByLabelText("Confirm password"),{target:{value:"different"}});
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");expect(screen.getByRole("button",{name:"Protect PDF"})).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirm password"),{target:{value:"secret"}});expect(screen.getByRole("button",{name:"Protect PDF"})).toBeEnabled();fireEvent.click(screen.getByRole("button",{name:"Protect PDF"}));
    expect(await screen.findByText(/Complete. The result/)).toBeVisible();await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/api/tools/protect",expect.objectContaining({method:"POST"})));
  });

  it("loads existing metadata and allows fields to be cleared",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockImplementation((path:string)=>{if(path==="/api/capabilities")return Promise.resolve({ok:true,status:200,json:async()=>capabilityPayload()});if(path==="/api/documents")return Promise.resolve({ok:true,status:200,json:async()=>({documents:[document]})});if(path.endsWith("/metadata"))return Promise.resolve({ok:true,status:200,json:async()=>({metadata:{title:"Old title",author:"A",subject:"S",keywords:"K"},information:{pageCount:2,fileSize:604,createdAt:document.createdAt,modifiedAt:document.updatedAt}})});return Promise.reject(new Error(`unexpected ${path}`));}));
    wrapper(<PhaseOneToolPage kind="metadata"/>);fireEvent.change(await screen.findByLabelText("Document"),{target:{value:document.id}});expect(await screen.findByDisplayValue("Old title")).toBeVisible();fireEvent.change(screen.getByLabelText("Title"),{target:{value:""}});expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("requires explicit acknowledgment before modifying a signed PDF",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockImplementation((path:string)=>{if(path==="/api/capabilities")return Promise.resolve({ok:true,status:200,json:async()=>capabilityPayload()});if(path==="/api/documents")return Promise.resolve({ok:true,status:200,json:async()=>({documents:[document]})});if(path.endsWith("/metadata"))return Promise.resolve({ok:true,status:200,json:async()=>({metadata:{title:"",author:"",subject:"",keywords:""},information:{pageCount:2,fileSize:604,createdAt:document.createdAt,modifiedAt:document.updatedAt,signed:true}})});return Promise.reject(new Error(`unexpected ${path}`));}));
    wrapper(<PhaseOneToolPage kind="page-numbers"/>);fireEvent.change(await screen.findByLabelText("Document"),{target:{value:document.id}});expect(await screen.findByText("This PDF contains digital signatures.")).toBeVisible();expect(screen.getByRole("button",{name:"Add page numbers"})).toBeDisabled();fireEvent.click(screen.getByLabelText(/This PDF contains digital signatures/));expect(screen.getByRole("button",{name:"Add page numbers"})).toBeEnabled();
  });
});
