package processing

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

func QPDFHasSignatures(ctx context.Context, inputPath string) (bool, error) {
	return QPDFHasSignaturesWithPassword(ctx, inputPath, "")
}

func QPDFHasSignaturesWithPassword(ctx context.Context, inputPath, password string) (bool, error) {
	executable, err := exec.LookPath("qpdf")
	if err != nil {
		return false, err
	}
	args := []string{}
	if password != "" {
		args = append(args, "--password="+password)
	}
	args = append(args, "--json", "--json-key=acroform", inputPath)
	command := exec.CommandContext(ctx, executable, args...)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return false, err
	}
	var stderr limitedBuffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		return false, err
	}
	found := false
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		normalized := strings.ReplaceAll(scanner.Text(), " ", "")
		if strings.Contains(normalized, `"fieldtype":"/Sig"`) || strings.Contains(normalized, `"fieldtype":"Sig"`) {
			found = true
		}
	}
	if err := scanner.Err(); err != nil {
		_ = command.Wait()
		return false, err
	}
	if err := command.Wait(); err != nil {
		return false, &ToolError{Code: CodeToolFailed, Tool: "qpdf", Output: stderr.String(), Err: err}
	}
	return found, nil
}

func QPDFPageCount(ctx context.Context, inputPath string) (*int32, error) {
	executable, err := exec.LookPath("qpdf")
	if err != nil {
		return nil, err
	}
	var output limitedBuffer
	command := exec.CommandContext(ctx, executable, "--show-npages", inputPath)
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Run(); err != nil {
		return nil, fmt.Errorf("qpdf page count: %w", err)
	}
	count, err := strconv.ParseInt(strings.TrimSpace(output.String()), 10, 32)
	if err != nil || count <= 0 {
		return nil, fmt.Errorf("qpdf returned invalid page count")
	}
	value := int32(count)
	return &value, nil
}
